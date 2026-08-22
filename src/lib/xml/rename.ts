/**
 * Rewriting every reference to a field when its `fieldname` changes.
 *
 * The write-side twin of `validation/refs.ts` + `validation/rules/references.ts`
 * (which answer "what does this text reference") and `validation/rules/
 * formManifest.ts` / `packageRules.ts` (which answer "does that reference
 * resolve"). Every site those modules check is rewritten here; nothing else
 * is touched, so this list must be kept in sync with them by hand.
 *
 * Two reference shapes, two strategies:
 *   - Exact-match fields (`skip.fieldname`, `calculation.field`, manifest
 *     fields, `entry_condition`'s LHS) are field-name slots with nothing
 *     else in them -- replaced only on a full case-insensitive match.
 *   - Free text (`logicCheck.condition`, `[[placeholder]]`s) can *contain* a
 *     field name alongside other content -- replaced via regex.
 *
 * `entry_condition` looks like a free-text expression but is not one: the
 * app (`parent_id_selector_screen.dart`) parses it as a literal
 * `field=value` pair via `split('=')`, never as the AND/OR/quoted-literal
 * grammar `logic_check` uses. Only the LHS is a field reference -- the RHS
 * is an opaque literal and must never be touched.
 */

import type {
  CalculationConfig,
  SkipRule,
  SurveyForm,
  SurveyPackage,
  SurveyQuestion,
} from '@/types/survey';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matches(value: string | undefined, oldName: string): boolean {
  return !!value && value.trim().toLowerCase() === oldName.trim().toLowerCase();
}

function renameExact(value: string | undefined, oldName: string, newName: string): string | undefined {
  return matches(value, oldName) ? newName : value;
}

/** A calculation `field`/`params[].field` may arrive `[[wrapped]]` (free text in the editor) or bare. */
function renameFieldRef(value: string | undefined, oldName: string, newName: string): string | undefined {
  if (!value) return value;
  const m = /^\[\[(\w+)\]\]$/.exec(value.trim());
  if (m) return matches(m[1], oldName) ? `[[${newName}]]` : value;
  return renameExact(value, oldName, newName);
}

/** Every `[[oldName]]` occurrence in free text, case-insensitively. */
function renamePlaceholders(text: string | undefined, oldName: string, newName: string): string | undefined {
  if (!text) return text;
  const re = new RegExp(`\\[\\[\\s*${escapeRegExp(oldName)}\\s*\\]\\]`, 'gi');
  return text.replace(re, `[[${newName}]]`);
}

/** A comma-separated field list (`primaryKey`, `displayFields`). */
function renameList(value: string | undefined, oldName: string, newName: string): string | undefined {
  if (!value) return value;
  let changed = false;
  const renamed = value
    .split(',')
    .map((part) => part.trim())
    .map((part) => {
      if (matches(part, oldName)) {
        changed = true;
        return newName;
      }
      return part;
    });
  return changed ? renamed.join(',') : value;
}

/**
 * A bareword expression (`logicCheck.condition`): replace `oldName` as a
 * whole word, skipping anything inside a single-quoted literal so a quoted
 * comparison value that happens to spell the field name is left alone --
 * mirrors `refs.ts`'s `QUOTED_STRING_RE` stripping, but rewrites instead of
 * discarding.
 */
function renameInExpression(expr: string | undefined, oldName: string, newName: string): string | undefined {
  if (!expr) return expr;
  const wordRe = new RegExp(`\\b${escapeRegExp(oldName)}\\b`, 'gi');
  return expr
    .split(/('[^']*')/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(wordRe, newName)))
    .join('');
}

/** `entry_condition`: a literal `field=value` pair -- only the LHS is a reference. */
function renameEntryCondition(value: string | undefined, oldName: string, newName: string): string | undefined {
  if (!value) return value;
  const eq = value.indexOf('=');
  if (eq === -1) return value;
  const field = value.slice(0, eq).trim();
  if (!matches(field, oldName)) return value;
  return `${newName}=${value.slice(eq + 1)}`;
}

function renameInCalculation(
  calc: CalculationConfig | undefined,
  oldName: string,
  newName: string,
): { calc: CalculationConfig | undefined; changed: boolean } {
  if (!calc) return { calc, changed: false };
  let changed = false;
  const next: CalculationConfig = { ...calc };

  const newField = renameFieldRef(calc.field, oldName, newName);
  if (newField !== calc.field) {
    next.field = newField;
    changed = true;
  }

  const newSql = renamePlaceholders(calc.sql, oldName, newName);
  if (newSql !== calc.sql) {
    next.sql = newSql;
    changed = true;
  }
  const newValue = renamePlaceholders(calc.value, oldName, newName);
  if (newValue !== calc.value) {
    next.value = newValue;
    changed = true;
  }
  const newSeparator = renamePlaceholders(calc.separator, oldName, newName);
  if (newSeparator !== calc.separator) {
    next.separator = newSeparator;
    changed = true;
  }

  if (calc.params) {
    let paramsChanged = false;
    const params = calc.params.map((p) => {
      const nf = renameFieldRef(p.field, oldName, newName);
      if (nf === p.field) return p;
      paramsChanged = true;
      return { ...p, field: nf! };
    });
    if (paramsChanged) {
      next.params = params;
      changed = true;
    }
  }

  if (calc.cases) {
    let casesChanged = false;
    const cases = calc.cases.map((k) => {
      let kase = k;
      const nf = renameExact(k.field, oldName, newName);
      if (nf !== k.field) {
        kase = { ...kase, field: nf! };
        casesChanged = true;
      }
      const { calc: nr, changed: rc } = renameInCalculation(k.result, oldName, newName);
      if (rc) {
        kase = { ...kase, result: nr! };
        casesChanged = true;
      }
      return kase;
    });
    if (casesChanged) {
      next.cases = cases;
      changed = true;
    }
  }

  if (calc.defaultResult) {
    const { calc: nd, changed: dc } = renameInCalculation(calc.defaultResult, oldName, newName);
    if (dc) {
      next.defaultResult = nd;
      changed = true;
    }
  }

  if (calc.parts) {
    let partsChanged = false;
    const parts = calc.parts.map((p) => {
      const { calc: np, changed: pc } = renameInCalculation(p, oldName, newName);
      if (!pc) return p;
      partsChanged = true;
      return np!;
    });
    if (partsChanged) {
      next.parts = parts;
      changed = true;
    }
  }

  return { calc: changed ? next : calc, changed };
}

function renameInSkipRule(rule: SkipRule, oldName: string, newName: string): { rule: SkipRule; changed: boolean } {
  let changed = false;
  let next = rule;

  const newFieldname = renameExact(rule.fieldname, oldName, newName);
  if (newFieldname !== rule.fieldname) {
    next = { ...next, fieldname: newFieldname! };
    changed = true;
  }

  // 'end' is the app's own end-of-form sentinel, never a fieldname.
  if (rule.skipToFieldname.trim().toLowerCase() !== 'end') {
    const newTarget = renameExact(rule.skipToFieldname, oldName, newName);
    if (newTarget !== rule.skipToFieldname) {
      next = { ...next, skipToFieldname: newTarget! };
      changed = true;
    }
  }

  if (rule.response_type === 'dynamic') {
    const newResponse = renameExact(rule.response, oldName, newName);
    if (newResponse !== rule.response) {
      next = { ...next, response: newResponse! };
      changed = true;
    }
  }

  return { rule: next, changed };
}

function renameInQuestion(
  q: SurveyQuestion,
  oldName: string,
  newName: string,
): { question: SurveyQuestion; changed: boolean } {
  let changed = false;
  let next = q;

  const newText = renamePlaceholders(q.text, oldName, newName);
  if (newText !== q.text) {
    next = { ...next, text: newText! };
    changed = true;
  }

  for (const kind of ['preskip', 'postskip'] as const) {
    const rules = q[kind];
    if (!rules) continue;
    let anyChanged = false;
    const renamed = rules.map((r) => {
      const { rule, changed: c } = renameInSkipRule(r, oldName, newName);
      if (c) anyChanged = true;
      return rule;
    });
    if (anyChanged) {
      next = { ...next, [kind]: renamed };
      changed = true;
    }
  }

  if (q.logicCheck) {
    let anyChanged = false;
    const checks = q.logicCheck.map((c) => {
      let nc = c;
      const cond = renameInExpression(c.condition, oldName, newName);
      if (cond !== c.condition) {
        nc = { ...nc, condition: cond! };
        anyChanged = true;
      }
      const msg = renamePlaceholders(c.message, oldName, newName);
      if (msg !== c.message) {
        nc = { ...nc, message: msg! };
        anyChanged = true;
      }
      return nc;
    });
    if (anyChanged) {
      next = { ...next, logicCheck: checks };
      changed = true;
    }
  }

  if (q.uniqueCheck) {
    const msg = renamePlaceholders(q.uniqueCheck.message, oldName, newName);
    if (msg !== q.uniqueCheck.message) {
      next = { ...next, uniqueCheck: { ...q.uniqueCheck, message: msg! } };
      changed = true;
    }
  }

  if (q.numericCheck) {
    const msg = renamePlaceholders(q.numericCheck.message, oldName, newName);
    if (msg !== q.numericCheck.message) {
      next = { ...next, numericCheck: { ...q.numericCheck, message: msg! } };
      changed = true;
    }
  }

  if (q.dynamicResponses?.filters?.length) {
    let anyChanged = false;
    const filters = q.dynamicResponses.filters.map((f) => {
      const v = renamePlaceholders(f.value, oldName, newName);
      if (v === f.value) return f;
      anyChanged = true;
      return { ...f, value: v! };
    });
    if (anyChanged) {
      next = { ...next, dynamicResponses: { ...q.dynamicResponses, filters } };
      changed = true;
    }
  }

  if (q.calculation) {
    const { calc, changed: c } = renameInCalculation(q.calculation, oldName, newName);
    if (c) {
      next = { ...next, calculation: calc };
      changed = true;
    }
  }

  return { question: next, changed };
}

/**
 * Rewrites every reference to `oldName` within `form` itself: its own
 * questions' skips/logic/calculations/text/filters, and this form's own
 * manifest fields (`primaryKey`, `displayFields`, `incrementField`,
 * `linkingfield`, `idconfig.fields[].name`).
 *
 * Does NOT touch `entry_condition` or `repeatCountField` on sibling forms --
 * both name a field on this form's *parent*, not this form, so a rename
 * here can never be the form those two point at. See `renameFieldAcrossPackage`.
 */
export function renameFieldInForm(
  form: SurveyForm,
  oldName: string,
  newName: string,
): { form: SurveyForm; count: number } {
  if (!oldName.trim() || !newName.trim() || oldName.trim().toLowerCase() === newName.trim().toLowerCase()) {
    return { form, count: 0 };
  }

  let count = 0;
  let next = form;

  const questions = form.questions.map((q) => {
    const { question, changed } = renameInQuestion(q, oldName, newName);
    if (changed) count++;
    return question;
  });
  if (count > 0) next = { ...next, questions };

  const newPrimaryKey = renameList(form.primaryKey, oldName, newName);
  if (newPrimaryKey !== form.primaryKey) {
    next = { ...next, primaryKey: newPrimaryKey };
    count++;
  }

  const newDisplayFields = renameList(form.displayFields, oldName, newName);
  if (newDisplayFields !== form.displayFields) {
    next = { ...next, displayFields: newDisplayFields };
    count++;
  }

  const newIncrementField = renameExact(form.incrementField, oldName, newName);
  if (newIncrementField !== form.incrementField) {
    next = { ...next, incrementField: newIncrementField };
    count++;
  }

  const newLinkingField = renameExact(form.linkingfield, oldName, newName);
  if (newLinkingField !== form.linkingfield) {
    next = { ...next, linkingfield: newLinkingField };
    count++;
  }

  if (form.idconfig) {
    let idChanged = false;
    const fields = form.idconfig.fields.map((f) => {
      if (!matches(f.name, oldName)) return f;
      idChanged = true;
      return { ...f, name: newName };
    });
    if (idChanged) {
      next = { ...next, idconfig: { ...form.idconfig, fields } };
      count++;
    }
  }

  return { form: next, count };
}

/**
 * Renames a field on `pkg.forms[formId]`, rewriting both that form's own
 * references (via `renameFieldInForm`) and the `entry_condition` /
 * `repeatCountField` of any direct child form -- both of which name a field
 * on their *parent*, i.e. this form.
 */
export function renameFieldAcrossPackage(
  pkg: SurveyPackage,
  formId: string,
  oldName: string,
  newName: string,
): { pkg: SurveyPackage; count: number } {
  const targetForm = pkg.forms.find((f) => f.id === formId);
  if (!targetForm) return { pkg, count: 0 };
  if (!oldName.trim() || !newName.trim() || oldName.trim().toLowerCase() === newName.trim().toLowerCase()) {
    return { pkg, count: 0 };
  }

  let count = 0;
  const targetKey = targetForm.tablename?.trim().toLowerCase();

  const forms = pkg.forms.map((form) => {
    if (form.id === formId) {
      const { form: renamed, count: c } = renameFieldInForm(form, oldName, newName);
      count += c;
      return renamed;
    }

    if (!targetKey || form.parenttable?.trim().toLowerCase() !== targetKey) return form;

    let next = form;
    let childChanged = false;

    const newRepeatCountField = renameExact(form.repeatCountField, oldName, newName);
    if (newRepeatCountField !== form.repeatCountField) {
      next = { ...next, repeatCountField: newRepeatCountField };
      childChanged = true;
    }

    const newEntryCondition = renameEntryCondition(form.entry_condition, oldName, newName);
    if (newEntryCondition !== form.entry_condition) {
      next = { ...next, entry_condition: newEntryCondition };
      childChanged = true;
    }

    if (childChanged) count++;
    return next;
  });

  return { pkg: count > 0 ? { ...pkg, forms } : pkg, count };
}
