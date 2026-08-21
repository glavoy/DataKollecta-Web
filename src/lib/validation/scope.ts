/**
 * Reference resolution -- form work, no knowledge of syntax.
 *
 * `refs.ts` answers "what names does this text mention"; this answers "does
 * that name resolve within this form, to what kind of field, and where does
 * it sit". Rules never walk `form.questions` themselves for this -- every
 * question-level reference rule goes through `FormScope.resolve()`, so the
 * resolution semantics (reserved-first ordering, case-insensitivity, the
 * leading/trailing split) live in exactly one place.
 */

import type { SurveyForm } from '@/types/survey';
import {
  KNOWN_AUTOMATIC_FIELDNAMES,
  LEADING_SYSTEM_FIELDS,
  TRAILING_SYSTEM_FIELDS,
} from '@/lib/xml/systemFields';

export type FieldKind = 'authored' | 'leadingSystem' | 'trailingSystem' | 'automatic' | 'unknown';

export interface FieldRef {
  kind: FieldKind;
  /** Array position -- only set for 'authored'. */
  index?: number;
}

const LEADING_NAMES = new Set(LEADING_SYSTEM_FIELDS.map((f) => f.fieldname));
const TRAILING_NAMES = new Set(TRAILING_SYSTEM_FIELDS.map((f) => f.fieldname));

export interface FormScope {
  form: SurveyForm;
  /**
   * Resolves a name to what it actually is in this form.
   *
   * Deliberately returns kind + index rather than a boolean verdict: the
   * rules that call this disagree about what the "equal position" case
   * means. A logic check referencing its own field is normal and expected; a
   * preskip testing its own field is always an error; a skip target equal to
   * the current question is always an error. A helper like `isAfter(name, i)`
   * would hide exactly the distinction each rule needs to make for itself.
   */
  resolve(name: string): FieldRef;
  /**
   * Field names this form's own manifest configuration already supplies --
   * primaryKey, displayFields, linkingfield, incrementField, and every
   * idconfig field name. Mirrors `processor.py::_supplied_auto_fields`: an
   * automatic question with no `calculation` is legal when its fieldname is
   * one of these, since the ID/linking machinery is what gives it a value,
   * not a calc block.
   */
  suppliedAutoFields: ReadonlySet<string>;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function suppliedAutoFieldsOf(form: SurveyForm): ReadonlySet<string> {
  const names = new Set<string>();
  for (const n of splitList(form.primaryKey)) names.add(n.toLowerCase());
  for (const n of splitList(form.displayFields)) names.add(n.toLowerCase());
  if (form.linkingfield) names.add(form.linkingfield.toLowerCase());
  if (form.incrementField) names.add(form.incrementField.toLowerCase());
  for (const f of form.idconfig?.fields ?? []) {
    if (f.name) names.add(f.name.toLowerCase());
  }
  return names;
}

/**
 * Builds a resolver for one form. Question order is array position -- there
 * is no explicit order field on `SurveyQuestion` -- so `indexOf` is built
 * once here and every ordering rule reads from it rather than calling
 * `Array.prototype.indexOf` repeatedly.
 *
 * A duplicate fieldname resolves to its FIRST index; `rules/identity.ts`
 * separately reports the duplication itself, so ordering rules that consult
 * a duplicated name still get a stable, meaningful answer rather than the
 * last-write-wins position.
 */
export function buildFormScope(form: SurveyForm): FormScope {
  const indexOf = new Map<string, number>();
  for (let i = 0; i < form.questions.length; i++) {
    const key = form.questions[i].fieldname?.trim().toLowerCase();
    if (key && !indexOf.has(key)) indexOf.set(key, i);
  }

  const suppliedAutoFields = suppliedAutoFieldsOf(form);

  function resolve(name: string): FieldRef {
    const key = name.trim().toLowerCase();

    // Reserved-first: `withSystemFields` drops a hand-declared reserved
    // field and re-injects its own at generation time, so declaring one
    // must never make a reference to it "authored" -- it would still be the
    // generator's own value, in the generator's own position.
    if (LEADING_NAMES.has(key)) return { kind: 'leadingSystem' };
    if (TRAILING_NAMES.has(key)) return { kind: 'trailingSystem' };

    const index = indexOf.get(key);
    if (index !== undefined) return { kind: 'authored', index };

    if (KNOWN_AUTOMATIC_FIELDNAMES.has(key)) return { kind: 'automatic' };

    return { kind: 'unknown' };
  }

  return { form, resolve, suppliedAutoFields };
}
