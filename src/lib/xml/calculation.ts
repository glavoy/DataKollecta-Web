/**
 * Emitting and parsing `<calculation>` nodes.
 *
 * Both directions are driven by one table, `CALC_SPEC`, so a type cannot emit
 * an attribute it doesn't have or lose one it does. The previous generator used
 * `if (calc.field) ... if (calc.value) ...` chains, which is how `age_at_date`
 * ended up writing its target date into the wrong attribute and producing a
 * calculation the app evaluates to an empty string.
 */

import type { CalculationConfig, CalculationCase, CalculationType } from '@/types/survey';
import { constantOf } from '@/types/survey';
import { el, type XmlElement, type XmlChild } from './emit';

/** Which node name this calculation is being written as. */
export type CalcTag = 'calculation' | 'part' | 'result';

type CalcAttr = 'value' | 'field' | 'separator' | 'operator' | 'unit';
type CalcChildren = 'none' | 'parts' | 'cases' | 'query';

export interface CalcTypeSpec {
  /** Attributes this type carries, emitted in this order and parsed from exactly this set. */
  attrs: readonly CalcAttr[];
  /**
   * Attributes accepted on parse but never emitted -- older files that used a
   * different attribute for the same thing. `normalizeCalculation` folds them
   * into the current representation and drops them.
   */
  legacyAttrs?: readonly CalcAttr[];
  children: CalcChildren;
  /** Legal `unit` values. Not enforced here -- for the validation phase and for docs. */
  units?: readonly string[];
  /** `field` may arrive as `[[wrapped]]`; stored bare. */
  fieldIsRef?: boolean;
}

export const CALC_SPEC: Record<CalculationType, CalcTypeSpec> = {
  constant: { attrs: ['value'], children: 'none' },
  lookup: { attrs: ['field'], children: 'none', fieldIsRef: true },
  query: { attrs: [], children: 'query' },
  math: { attrs: ['operator'], children: 'parts' },
  concat: { attrs: ['separator'], children: 'parts' },
  case: { attrs: [], children: 'cases' },

  // `value` is the unit ('years'|'months'|'days'), `separator` is the target
  // date. Both are the app's contract, verified in auto_fields.dart.
  age_at_date: {
    attrs: ['field', 'value', 'separator'],
    // Earlier web packages wrote the unit as unit='y'; read it so it can be
    // converted, but never write it back.
    legacyAttrs: ['unit'],
    children: 'none',
    fieldIsRef: true,
    units: ['years', 'months', 'days'],
  },
  // Deprecated in the app, which rewrites it to age_at_date with
  // separator='[[startdate]]'. Kept so existing files parse; normalised on import.
  age_from_date: {
    attrs: ['field', 'value'],
    legacyAttrs: ['unit'],
    children: 'none',
    fieldIsRef: true,
    units: ['years', 'months', 'days'],
  },

  date_offset: { attrs: ['field', 'value'], children: 'none', fieldIsRef: true },
  date_diff: {
    attrs: ['field', 'value', 'unit'],
    children: 'none',
    fieldIsRef: true,
    units: ['y', 'm', 'w', 'd'],
  },
  date_part: {
    attrs: ['field', 'unit'],
    children: 'none',
    fieldIsRef: true,
    units: ['yyyy', 'yy', 'mm', 'dd', 'doy'],
  },
};

const REF_RE = /^\[\[(\w+)\]\]$/;

/** `[[dob]]` -> `dob`. Anything else passes through. */
function unwrapRef(value: string): string {
  const m = REF_RE.exec(value.trim());
  return m ? m[1] : value;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/**
 * `tag` is chosen by the caller from POSITION, never from `c.type`.
 *
 * This matters: the app collects math/concat operands with
 * `findElements('part')` and case results with `getElement('result')`. The
 * Python generator picks the tag from the child's own type, so a constant
 * operand inside a `math` is written as `<result>` and the app silently drops
 * it -- the arithmetic then runs on the wrong operands. Do not replicate that.
 */
export function emitCalculation(c: CalculationConfig, tag: CalcTag): XmlElement {
  const spec = CALC_SPEC[c.type];
  const attrs: Record<string, string | undefined> = { type: c.type };

  if (spec) {
    for (const name of spec.attrs) {
      attrs[name] = c[name] as string | undefined;
    }
  } else {
    // Unknown type from a hand-edited file: pass through what we have rather
    // than silently dropping the node.
    attrs.value = c.value;
    attrs.field = c.field;
    attrs.separator = c.separator;
    attrs.operator = c.operator;
    attrs.unit = c.unit;
  }

  if (c.preserve) attrs.preserve = 'true';

  const children: XmlChild[] = [];
  switch (spec?.children) {
    case 'parts':
      for (const part of c.parts ?? []) children.push(emitCalculation(part, 'part'));
      break;

    case 'cases':
      for (const kase of c.cases ?? []) {
        children.push(
          el('when', { field: kase.field, operator: kase.operator, value: kase.value }, [
            emitCalculation(kase.result ?? constantOf(''), 'result'),
          ]),
        );
      }
      if (c.defaultResult) {
        children.push(el('else', {}, [emitCalculation(c.defaultResult, 'result')]));
      }
      break;

    case 'query':
      if (c.sql !== undefined) children.push({ name: 'sql', text: c.sql });
      for (const p of c.params ?? []) {
        children.push(el('parameter', { name: p.name, field: p.field }));
      }
      break;
  }

  return el(tag, attrs, children.length > 0 ? children : undefined);
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/** fast-xml-parser gives a single child as an object and repeats as an array. */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function attr(raw: Record<string, unknown>, name: string): string | undefined {
  const v = raw[name];
  // `?? undefined` and not a truthiness check: '0' and '' are real values, and
  // dropping them is what made case results lose `value='0'`.
  return v === undefined || v === null ? undefined : String(v);
}

/** Text of a `<sql>` node, which fast-xml-parser may hand back several ways. */
function textOf(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['#text'];
    return t === undefined || t === null ? '' : String(t);
  }
  return String(node);
}

export function parseCalculation(raw: unknown): CalculationConfig | undefined {
  if (raw === undefined || raw === null || typeof raw !== 'object') return undefined;
  const node = raw as Record<string, unknown>;

  const type = (attr(node, 'type') ?? 'constant') as CalculationType;
  const spec = CALC_SPEC[type];

  const config: CalculationConfig = { type };

  const names: readonly CalcAttr[] = spec
    ? [...spec.attrs, ...(spec.legacyAttrs ?? [])]
    : (['value', 'field', 'separator', 'operator', 'unit'] as const);

  for (const name of names) {
    const value = attr(node, name);
    if (value === undefined) continue;
    if (name === 'field' && spec?.fieldIsRef) {
      config.field = unwrapRef(value);
    } else {
      (config as unknown as Record<string, unknown>)[name] = value;
    }
  }

  if (attr(node, 'preserve') === 'true') config.preserve = true;

  switch (spec?.children) {
    case 'parts': {
      const parts = asArray(node.part)
        .map((p) => parseCalculation(p))
        .filter((p): p is CalculationConfig => p !== undefined);
      // `<result>` children here are what the Python generator writes for a
      // constant operand. The app ignores them, but we accept them on read so
      // an existing package round-trips into something that actually works.
      const strays = asArray(node.result)
        .map((p) => parseCalculation(p))
        .filter((p): p is CalculationConfig => p !== undefined);
      config.parts = [...parts, ...strays];
      break;
    }

    case 'cases': {
      const cases: CalculationCase[] = [];
      asArray(node.when).forEach((w, i) => {
        if (!w || typeof w !== 'object') return;
        const when = w as Record<string, unknown>;
        const result = parseCalculation(when.result) ?? constantOf('');
        cases.push({
          id: `case-${i}`,
          field: attr(when, 'field') ?? '',
          operator: (attr(when, 'operator') ?? '=') as CalculationCase['operator'],
          value: attr(when, 'value') ?? '',
          result,
        });
      });
      config.cases = cases;

      const elseNode = asArray(node.else)[0];
      if (elseNode && typeof elseNode === 'object') {
        config.defaultResult = parseCalculation(
          (elseNode as Record<string, unknown>).result,
        );
      }
      break;
    }

    case 'query': {
      const sql = textOf(asArray(node.sql)[0]);
      if (sql !== undefined) config.sql = sql.trim();
      const params = asArray(node.parameter)
        .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
        .map((p) => ({ name: attr(p, 'name') ?? '', field: attr(p, 'field') ?? '' }));
      if (params.length > 0) config.params = params;
      break;
    }
  }

  return config;
}

/**
 * Rewrite the deprecated `age_from_date` into the `age_at_date` the app
 * actually runs -- the same substitution `auto_fields.dart` performs at
 * runtime, done once at import so what we store is what we emit.
 */
export function normalizeCalculation(c: CalculationConfig): CalculationConfig {
  let out = c;

  if (out.type === 'age_from_date') {
    out = {
      ...out,
      type: 'age_at_date',
      separator: out.separator ?? '[[startdate]]',
    };
  }

  if (out.type === 'age_at_date' || out.type === 'age_from_date') {
    // Older web packages wrote 'y'/'m' into `unit`; the app matches the full
    // words in `value`.
    const fromUnit =
      out.unit === 'y' ? 'years' : out.unit === 'm' ? 'months' : out.unit === 'd' ? 'days' : undefined;
    if (fromUnit && !isAgeUnit(out.value)) {
      out = { ...out, value: fromUnit };
    }
    if (out.unit !== undefined) {
      const { unit: _drop, ...rest } = out;
      out = rest as CalculationConfig;
    }
  }

  if (out.parts) out = { ...out, parts: out.parts.map(normalizeCalculation) };
  if (out.cases) {
    out = {
      ...out,
      cases: out.cases.map((k) => ({ ...k, result: normalizeCalculation(k.result) })),
    };
  }
  if (out.defaultResult) {
    out = { ...out, defaultResult: normalizeCalculation(out.defaultResult) };
  }

  return out;
}

function isAgeUnit(v: string | undefined): boolean {
  return v === 'years' || v === 'months' || v === 'days';
}
