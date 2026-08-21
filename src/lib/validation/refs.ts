/**
 * Reference extraction -- pure string work, no knowledge of forms.
 *
 * This half of the reference system answers "what field names does this
 * text/calculation *mention*"; `scope.ts` answers "does that name resolve,
 * and where". Splitting them means the regex work (ported from
 * `excel_reader.py`) and the form-lookup work (which has no Python
 * equivalent -- SurveyGen only ever validates one worksheet in isolation)
 * never entangle.
 */

import type { CalculationConfig } from '@/types/survey';

const QUOTED_STRING_RE = /'[^']*'/g;
const FIELD_NAME_RE = /\b[a-z_][a-z0-9_]*\b/gi;
const PLACEHOLDER_RE = /\[\[(\w+)\]\]/g;
const REF_RE = /^\[\[(\w+)\]\]$/;

const LOGIC_KEYWORDS = new Set(['and', 'or', 'not', 'contains', 'does', 'contain']);

/** `[[dob]]` -> `dob`. Anything else passes through unchanged. */
export function unwrapRef(value: string): string {
  const m = REF_RE.exec(value.trim());
  return m ? m[1] : value;
}

/**
 * Field names referenced by a free-text expression (a logic-check condition,
 * a skip's tested value when it's `response_type: 'dynamic'`, etc).
 *
 * Ported from `_check_logic_field_names`: strip quoted literals first (so a
 * message embedded in the expression, or a quoted comparison value, never
 * contributes a false reference), match bareword identifiers, then drop the
 * boolean/contains vocabulary. `contain` is in the keyword set because
 * `'does not contain'`, after quote-stripping, tokenizes to three separate
 * words.
 *
 * Deliberately uses `matchAll`, never a shared `/g` regex with `.exec()` in a
 * loop -- `lastIndex` is stateful, and reusing a module-level `/g` regex
 * across calls is the classic way a ported regex silently skips every other
 * match.
 */
export function expressionRefs(expression: string): string[] {
  const cleaned = expression.replace(QUOTED_STRING_RE, '');
  const seen = new Set<string>();
  for (const m of cleaned.matchAll(FIELD_NAME_RE)) {
    const name = m[0];
    if (!LOGIC_KEYWORDS.has(name.toLowerCase())) seen.add(name);
  }
  return [...seen];
}

/** `[[fieldname]]` placeholders in question text, filter values, SQL, etc. */
export function placeholderRefs(text: string | undefined | null): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) seen.add(m[1]);
  return [...seen];
}

export type CalcRefOrigin = 'field' | 'case' | 'param' | 'placeholder';

export interface CalcRef {
  name: string;
  /** Nested trail for error messages, e.g. `parts[1].cases[0].field`. */
  path: string;
  origin: CalcRefOrigin;
}

/**
 * Every field a calculation reads, walking the recursive `CalculationConfig`
 * (math/concat parts, case branches and their results, query parameters).
 *
 * SurveyGen never validates these at all -- `_question_field_refs` exists
 * only to feed the reserved-variable check, so a `calc:lookup` on a
 * nonexistent field, or a typo'd `[[placeholder]]` in a `sql:` block,
 * produces no error there. This is new coverage, not a straight port.
 *
 * Two things a literal port would get wrong:
 *   - `field` may arrive wrapped (`[[dob]]`): the parser only unwraps it for
 *     calc types whose spec marks `fieldIsRef`, but `CalculationEditor`'s
 *     inputs are free text, so an author can type the brackets. Always
 *     unwrap here regardless of type.
 *   - `value` is scanned for placeholders ONLY, never as a bareword
 *     expression -- it holds a literal, an age-unit word ('years'), or a
 *     date offset ('+28d') depending on calc type, none of which are field
 *     references by themselves.
 */
export function calculationRefs(calc: CalculationConfig | undefined, prefix = ''): CalcRef[] {
  if (!calc) return [];
  const refs: CalcRef[] = [];

  if (calc.field) {
    refs.push({ name: unwrapRef(calc.field), path: `${prefix}field`, origin: 'field' });
  }
  for (const name of placeholderRefs(calc.sql)) {
    refs.push({ name, path: `${prefix}sql`, origin: 'placeholder' });
  }
  for (const name of placeholderRefs(calc.value)) {
    refs.push({ name, path: `${prefix}value`, origin: 'placeholder' });
  }
  for (const name of placeholderRefs(calc.separator)) {
    refs.push({ name, path: `${prefix}separator`, origin: 'placeholder' });
  }
  (calc.params ?? []).forEach((p, i) => {
    if (p.field) {
      refs.push({ name: unwrapRef(p.field), path: `${prefix}params[${i}]`, origin: 'param' });
    }
  });
  (calc.cases ?? []).forEach((k, i) => {
    if (k.field) {
      refs.push({ name: k.field, path: `${prefix}cases[${i}]`, origin: 'case' });
    }
    refs.push(...calculationRefs(k.result, `${prefix}cases[${i}].result.`));
  });
  refs.push(...calculationRefs(calc.defaultResult, `${prefix}defaultResult.`));
  (calc.parts ?? []).forEach((p, i) => {
    refs.push(...calculationRefs(p, `${prefix}parts[${i}].`));
  });

  return refs;
}
