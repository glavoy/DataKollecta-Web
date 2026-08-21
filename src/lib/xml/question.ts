/**
 * `<question>` emission and parsing.
 *
 * Child element order follows what SurveyGen writes. The app uses a real XML
 * parser and does not care about order, but matching it keeps a diff between
 * the two generators' output readable, which is worth something while both
 * exist.
 */

import type {
  DynamicResponseConfig,
  LogicCheck,
  QuestionType,
  ResponseOption,
  SkipRule,
  SurveyQuestion,
} from '@/types/survey';
import { el, textEl, type XmlChild, type XmlElement } from './emit';
import { emitCalculation, normalizeCalculation, parseCalculation } from './calculation';

// ---------------------------------------------------------------------------
// Wire vocabulary
// ---------------------------------------------------------------------------

/**
 * The XML says `automatic`; the designer says `calculated`. The app accepts
 * `calc`/`calculation`/`calculated` as spellings of `automatic`, but emitting
 * the canonical one means round-tripping a file doesn't rewrite its vocabulary.
 */
const WIRE_QUESTION_TYPE: Partial<Record<QuestionType, string>> = {
  calculated: 'automatic',
};

const MODEL_QUESTION_TYPE: Record<string, QuestionType> = {
  automatic: 'calculated',
  calc: 'calculated',
  calculation: 'calculated',
  calculated: 'calculated',
  text: 'text',
  radio: 'radio',
  checkbox: 'checkbox',
  combobox: 'combobox',
  date: 'date',
  datetime: 'datetime',
  information: 'information',
  // No 'button' mapping: the type was retired (see QuestionType in
  // survey.ts) and the app's own parseQuestionType has never had a case for
  // it either -- an incoming type='button' from an old file falls through
  // to the same 'information' default the app itself uses.
};

export const toWireType = (t: QuestionType): string => WIRE_QUESTION_TYPE[t] ?? t;
export const toModelType = (t: string): QuestionType =>
  MODEL_QUESTION_TYPE[t?.trim().toLowerCase()] ?? 'information';

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/**
 * Which response block will actually be emitted for a question whose
 * `responseMode` wasn't explicitly set. Exported so the validation engine
 * checks the same default this generator uses -- a validator that disagreed
 * with the emitter about what will be emitted would be worse than no
 * validator at all.
 */
export function resolvedResponseMode(q: SurveyQuestion): 'static' | 'dynamic' {
  return q.responseMode ?? (q.dynamicResponses ? 'dynamic' : 'static');
}

function emitResponses(q: SurveyQuestion): XmlElement | undefined {
  const mode = resolvedResponseMode(q);

  if (mode === 'dynamic' && q.dynamicResponses) {
    const dr = q.dynamicResponses;
    const children: XmlChild[] = [];

    for (const f of dr.filters ?? []) {
      children.push(el('filter', { column: f.column, operator: f.operator, value: f.value }));
    }
    children.push(el('display', { column: dr.displayColumn }));
    children.push(el('value', { column: dr.valueColumn }));
    if (dr.emptyMessage !== undefined) {
      children.push(textEl('empty_message', dr.emptyMessage));
    }
    if (dr.notInList) {
      children.push(
        el('not_in_list', { value: dr.notInList.value, label: dr.notInList.label }),
      );
    }
    if (dr.dontKnow) {
      children.push(el('dont_know', { value: dr.dontKnow.value, label: dr.dontKnow.label }));
    }
    // Only emit when the author made a choice: the app defaults an ABSENT
    // <distinct> to true, so writing `false` by default would change behaviour.
    if (dr.distinct !== undefined) {
      children.push(textEl('distinct', String(dr.distinct)));
    }

    return el(
      'responses',
      dr.source === 'csv'
        ? { source: 'csv', file: dr.file }
        : { source: 'database', table: dr.table },
      children,
    );
  }

  if (q.responses && q.responses.length > 0) {
    return el(
      'responses',
      {},
      q.responses.map((r) => ({ name: 'response', attrs: { value: r.value }, text: r.label })),
    );
  }

  return undefined;
}

function emitSkips(name: 'preskip' | 'postskip', rules: SkipRule[] | undefined) {
  if (!rules || rules.length === 0) return undefined;
  return el(
    name,
    {},
    rules.map((s) =>
      el('skip', {
        fieldname: s.fieldname,
        condition: s.condition,
        response: s.response,
        response_type: s.response_type ?? 'fixed',
        skiptofieldname: s.skipToFieldname,
      }),
    ),
  );
}

/** `<maxCharacters>=3</maxCharacters>` means "exactly 3". */
function encodeWidth(value: number | undefined, fixed: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return fixed ? `=${value}` : String(value);
}

export function emitQuestion(q: SurveyQuestion): XmlElement {
  const isAutomatic = q.type === 'calculated';
  const children: XmlChild[] = [];

  // Automatic questions render no UI, so they carry no text.
  if (!isAutomatic && q.text !== undefined && q.text !== '') {
    children.push(textEl('text', q.text));
  }

  if (q.calculation) {
    children.push(emitCalculation(q.calculation, 'calculation'));
  }

  children.push(textEl('maxCharacters', encodeWidth(q.maxCharacters, q.fixedLength)));
  children.push(textEl('numeric_range', q.numericRange === undefined ? undefined : `=${q.numericRange}`));

  if (q.mask) children.push(el('mask', { value: q.mask }));

  if (q.uniqueCheck) {
    children.push(el('unique_check', {}, [textEl('message', q.uniqueCheck.message)]));
  }

  if (q.numericCheck) {
    const nc = q.numericCheck;
    children.push(
      el('numeric_check', {}, [
        el('values', {
          minvalue: nc.minValue,
          maxvalue: nc.maxValue,
          other_values: nc.otherValues,
          message: nc.message,
        }),
      ]),
    );
  }

  if (q.dateRange && (q.dateRange.minDate !== undefined || q.dateRange.maxDate !== undefined)) {
    children.push(
      el('date_range', {}, [
        textEl('min_date', q.dateRange.minDate),
        textEl('max_date', q.dateRange.maxDate),
      ]),
    );
  }

  for (const check of q.logicCheck ?? []) {
    // Modern form: the message is an attribute. The app prefers it and only
    // falls back to splitting the text on ';' -- which truncates any message
    // containing a semicolon.
    children.push({
      name: 'logic_check',
      attrs: { message: check.message },
      text: check.condition,
    });
  }

  children.push(emitResponses(q));
  children.push(emitSkips('preskip', q.preskip));
  children.push(emitSkips('postskip', q.postskip));

  children.push(textEl('dont_know', q.dontKnow));
  children.push(textEl('refuse', q.refuse));
  children.push(textEl('na', q.na));

  return el(
    'question',
    { type: toWireType(q.type), fieldname: q.fieldname, fieldtype: q.fieldtype },
    children,
  );
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function attr(raw: Record<string, unknown>, name: string): string | undefined {
  const v = raw[name];
  return v === undefined || v === null ? undefined : String(v);
}

/** Element text, tolerating every shape fast-xml-parser produces. */
function textOf(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['#text'];
    return t === undefined || t === null ? '' : String(t);
  }
  // Numeric-looking text arrives as a number when parseTagValue is on; String()
  // handles it, and using `typeof v === 'string'` here is what previously
  // turned a numeric question text into ''.
  return String(node);
}

function numOf(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text.trim());
  return Number.isFinite(n) ? n : undefined;
}

/** Splits '=3' into { value: 3, fixed: true }. */
function decodeWidth(text: string | undefined): { value?: number; fixed?: boolean } {
  if (text === undefined) return {};
  const t = text.trim();
  if (t === '') return {};
  const fixed = t.startsWith('=');
  const value = numOf(fixed ? t.slice(1) : t);
  if (value === undefined) return {};
  return fixed ? { value, fixed: true } : { value };
}

function parseResponses(node: Record<string, unknown>, out: SurveyQuestion): void {
  const responsesNode = asArray(node.responses)[0];
  if (!responsesNode || typeof responsesNode !== 'object') return;
  const r = responsesNode as Record<string, unknown>;

  const source = attr(r, 'source');

  if (source === 'csv' || source === 'database') {
    const dr: DynamicResponseConfig = {
      source,
      file: attr(r, 'file'),
      table: attr(r, 'table'),
      displayColumn: attr(asArray(r.display)[0] as Record<string, unknown> ?? {}, 'column') ?? '',
      valueColumn: attr(asArray(r.value)[0] as Record<string, unknown> ?? {}, 'column') ?? '',
      filters: asArray(r.filter)
        .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
        .map((f) => ({
          column: attr(f, 'column') ?? '',
          operator: attr(f, 'operator') ?? '=',
          value: attr(f, 'value') ?? '',
        })),
    };

    const emptyMessage = textOf(asArray(r.empty_message)[0]);
    if (emptyMessage !== undefined) dr.emptyMessage = emptyMessage;

    const distinct = textOf(asArray(r.distinct)[0]);
    if (distinct !== undefined) dr.distinct = distinct.trim().toLowerCase() === 'true';

    const dk = asArray(r.dont_know)[0];
    if (dk && typeof dk === 'object') {
      const d = dk as Record<string, unknown>;
      // `?? `, not `||`: a legitimate value of '0' must survive.
      dr.dontKnow = { value: attr(d, 'value') ?? '', label: attr(d, 'label') ?? "Don't know" };
    }

    const nil = asArray(r.not_in_list)[0];
    if (nil && typeof nil === 'object') {
      const n = nil as Record<string, unknown>;
      dr.notInList = { value: attr(n, 'value') ?? '', label: attr(n, 'label') ?? 'Not in this list' };
    }

    out.dynamicResponses = dr;
    out.responseMode = 'dynamic';
    return;
  }

  const options: ResponseOption[] = asArray(r.response)
    .map((resp, i): ResponseOption | undefined => {
      if (resp === undefined || resp === null) return undefined;
      if (typeof resp === 'object') {
        const o = resp as Record<string, unknown>;
        const value = attr(o, 'value');
        const label = textOf(o) ?? '';
        // SurveyGen writes a bare <response></response> for a question with no
        // options; that is not a real option.
        if (value === undefined && label === '') return undefined;
        return { id: `opt-${i}`, value: value ?? '', label };
      }
      return { id: `opt-${i}`, value: String(resp), label: String(resp) };
    })
    .filter((o): o is ResponseOption => o !== undefined);

  if (options.length > 0) {
    out.responses = options;
    out.responseMode = 'static';
  }
}

function parseSkips(node: unknown, kind: 'preskip' | 'postskip'): SkipRule[] | undefined {
  const wrapper = asArray(node)[0];
  if (!wrapper || typeof wrapper !== 'object') return undefined;
  const rules = asArray((wrapper as Record<string, unknown>).skip)
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s, i) => ({
      id: `${kind}-${i}`,
      fieldname: attr(s, 'fieldname') ?? '',
      condition: (attr(s, 'condition') ?? '=') as SkipRule['condition'],
      response: attr(s, 'response') ?? '',
      response_type: (attr(s, 'response_type') ?? 'fixed') as SkipRule['response_type'],
      skipToFieldname: attr(s, 'skiptofieldname') ?? '',
    }));
  return rules.length > 0 ? rules : undefined;
}

function parseLogicChecks(node: unknown): LogicCheck[] | undefined {
  const checks = asArray(node)
    .map((raw): LogicCheck | undefined => {
      if (raw === undefined || raw === null) return undefined;

      let message: string | undefined;
      let body: string;

      if (typeof raw === 'object') {
        const o = raw as Record<string, unknown>;
        message = attr(o, 'message');
        body = textOf(o) ?? '';
      } else {
        body = String(raw);
      }

      // Collapse SurveyGen's multi-line `or` layout into one expression.
      let condition = body.replace(/\s+/g, ' ').trim();

      // Legacy form: "condition; 'message'".
      if (message === undefined && condition.includes(';')) {
        const idx = condition.indexOf(';');
        const rest = condition.slice(idx + 1).trim();
        condition = condition.slice(0, idx).trim();
        message = rest.replace(/^'|'$/g, '');
      }

      if (condition === '') return undefined;
      return { condition, message: message ?? 'Invalid value' };
    })
    .filter((c): c is LogicCheck => c !== undefined);

  return checks.length > 0 ? checks : undefined;
}

export function parseQuestion(raw: Record<string, unknown>, index: number): SurveyQuestion {
  const q: SurveyQuestion = {
    id: `q-${index}`,
    type: toModelType(attr(raw, 'type') ?? 'information'),
    fieldname: attr(raw, 'fieldname') ?? '',
    fieldtype: (attr(raw, 'fieldtype') ?? 'text') as SurveyQuestion['fieldtype'],
    text: textOf(asArray(raw.text)[0]) ?? '',
  };

  const width = decodeWidth(textOf(asArray(raw.maxCharacters)[0]));
  if (width.value !== undefined) q.maxCharacters = width.value;
  if (width.fixed) q.fixedLength = true;

  const range = decodeWidth(textOf(asArray(raw.numeric_range)[0]));
  if (range.value !== undefined) q.numericRange = range.value;

  const maskNode = asArray(raw.mask)[0];
  if (maskNode !== undefined && maskNode !== null) {
    const mask =
      typeof maskNode === 'object'
        ? attr(maskNode as Record<string, unknown>, 'value') ?? textOf(maskNode)
        : String(maskNode);
    if (mask !== undefined && mask !== '') q.mask = mask;
  }

  const calc = parseCalculation(asArray(raw.calculation)[0]);
  if (calc) q.calculation = normalizeCalculation(calc);

  const unique = asArray(raw.unique_check)[0];
  if (unique && typeof unique === 'object') {
    const message = textOf(asArray((unique as Record<string, unknown>).message)[0]);
    q.uniqueCheck = { message: message ?? '' };
  }

  const numeric = asArray(raw.numeric_check)[0];
  if (numeric && typeof numeric === 'object') {
    const values = asArray((numeric as Record<string, unknown>).values)[0];
    if (values && typeof values === 'object') {
      const v = values as Record<string, unknown>;
      // `!== undefined`, not truthiness: minvalue='0' is a real floor, and
      // dropping it silently made a 0..N range unbounded below.
      const min = numOf(attr(v, 'minvalue'));
      const max = numOf(attr(v, 'maxvalue'));
      q.numericCheck = {
        minValue: min,
        maxValue: max,
        otherValues: attr(v, 'other_values'),
        message: attr(v, 'message') ?? '',
      };
    }
  }

  const dateRange = asArray(raw.date_range)[0];
  if (dateRange && typeof dateRange === 'object') {
    const d = dateRange as Record<string, unknown>;
    const minDate = textOf(asArray(d.min_date)[0]);
    const maxDate = textOf(asArray(d.max_date)[0]);
    if (minDate !== undefined || maxDate !== undefined) {
      q.dateRange = { minDate, maxDate };
    }
  }

  const logic = parseLogicChecks(raw.logic_check);
  if (logic) q.logicCheck = logic;

  parseResponses(raw, q);

  const pre = parseSkips(raw.preskip, 'preskip');
  if (pre) q.preskip = pre;
  const post = parseSkips(raw.postskip, 'postskip');
  if (post) q.postskip = post;

  const dontKnow = textOf(asArray(raw.dont_know)[0]);
  if (dontKnow !== undefined) q.dontKnow = dontKnow;
  const refuse = textOf(asArray(raw.refuse)[0]);
  if (refuse !== undefined) q.refuse = refuse;
  const na = textOf(asArray(raw.na)[0]);
  if (na !== undefined) q.na = na;

  return q;
}
