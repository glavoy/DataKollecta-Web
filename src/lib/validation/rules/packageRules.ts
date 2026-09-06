/**
 * Cross-form concerns: unique table names, the parent/child relationship
 * between forms, exactly one base form, and basic package identity.
 *
 * No SurveyGen equivalent at all -- it validates one worksheet at a time and
 * never sees the relationships between them. The designer has real
 * multi-table surveys (a household form linking to a member form, etc.),
 * and none of this was checked before.
 */

import type { SurveyForm, SurveyPackage, SurveyQuestion } from '@/types/survey';
import { RULE, type Finding } from '../types';
import { isBaseForm } from '@/lib/xml/manifest';
import { buildFormScope } from '../scope';
import { LEADING_SYSTEM_FIELDS, TRAILING_SYSTEM_FIELDS, KNOWN_AUTOMATIC_FIELDNAMES } from '@/lib/xml/systemFields';

const TABLENAME_RE = /^[a-z_][a-z0-9_]*$/;

/** A comma-separated manifest cell as a list of trimmed names. */
function splitList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function tablenameFindings(pkg: SurveyPackage): Finding[] {
  const findings: Finding[] = [];
  const seen = new Map<string, string[]>(); // lowercased tablename -> form ids

  for (const form of pkg.forms) {
    const name = form.tablename?.trim() ?? '';
    if (!TABLENAME_RE.test(name)) {
      findings.push({
        scope: 'form',
        formId: form.id,
        tablename: form.tablename,
        part: 'manifest',
        ruleId: RULE.tablenameInvalid,
        severity: 'error',
        subject: form.tablename,
        message: `Table name '${form.tablename}' must start with a letter and contain only lowercase letters, digits, and underscores.`,
      });
    }
    if (!name) continue;
    const key = name.toLowerCase();
    const ids = seen.get(key) ?? [];
    ids.push(form.id);
    seen.set(key, ids);
  }

  for (const [key, ids] of seen) {
    if (ids.length < 2) continue;
    for (const formId of ids) {
      const form = pkg.forms.find((f) => f.id === formId)!;
      findings.push({
        scope: 'form',
        formId: form.id,
        tablename: form.tablename,
        part: 'manifest',
        ruleId: RULE.tablenameDuplicate,
        severity: 'error',
        subject: key,
        message: `Table name '${form.tablename}' is used by ${ids.length} forms.`,
        hint: 'Each form becomes its own database table -- the name must be unique across the survey.',
      });
    }
  }

  return findings;
}

/**
 * Walks a form's parent chain looking for a loop back to itself. Self-parent
 * (`parenttable === tablename`) is deliberately handled by the same walk
 * rather than a special case: the form's own key is seeded into `visited`
 * before the loop starts, so a self-reference is caught on the first step.
 */
function findCycle(form: SurveyForm, byTablename: ReadonlyMap<string, SurveyForm>): string[] | null {
  const startKey = form.tablename?.trim().toLowerCase();
  if (!startKey) return null;

  const visited = new Set<string>([startKey]);
  const chain = [form.tablename];
  let current: SurveyForm | undefined = form;

  while (current?.parenttable) {
    const parentKey = current.parenttable.trim().toLowerCase();
    chain.push(current.parenttable);
    if (visited.has(parentKey)) return chain;
    visited.add(parentKey);
    current = byTablename.get(parentKey);
  }

  return null;
}

function parentChainFindings(pkg: SurveyPackage): Finding[] {
  const findings: Finding[] = [];
  const byTablename = new Map<string, SurveyForm>();
  for (const form of pkg.forms) {
    const key = form.tablename?.trim().toLowerCase();
    if (key) byTablename.set(key, form);
  }

  for (const form of pkg.forms) {
    if (!form.parenttable) continue;
    const base = {
      scope: 'form' as const,
      formId: form.id,
      tablename: form.tablename,
      part: 'manifest' as const,
    };
    const parentKey = form.parenttable.trim().toLowerCase();

    if (!byTablename.has(parentKey)) {
      findings.push({
        ...base,
        ruleId: RULE.parentMissing,
        severity: 'error',
        subject: form.parenttable,
        message: `Parent table '${form.parenttable}' does not exist in this survey.`,
      });
      continue; // a nonexistent parent can't form a cycle
    }

    const cycle = findCycle(form, byTablename);
    if (cycle) {
      findings.push({
        ...base,
        ruleId: RULE.parentCycle,
        severity: 'error',
        message: `The parent chain loops back on itself: ${cycle.join(' -> ')}.`,
        hint: 'A form cannot be its own ancestor, directly or through another form.',
      });
    }
  }

  return findings;
}

function baseFormCountFindings(pkg: SurveyPackage): Finding[] {
  if (pkg.forms.length === 0) return [];

  const baseForms = pkg.forms.filter(isBaseForm);
  if (baseForms.length === 1) return [];

  const message =
    baseForms.length === 0
      ? 'This survey has no base form (a form with no parent table).'
      : `This survey has ${baseForms.length} base forms (forms with no parent table): ${baseForms.map((f) => f.tablename).join(', ')}.`;

  return [
    {
      scope: 'package',
      ruleId: RULE.baseFormCount,
      severity: 'error',
      message,
      hint: 'Exactly one form must be the base -- the top-level record every other form links to.',
    },
  ];
}

/**
 * `entry_condition` and `repeatCountField` are the one place a *child*
 * form's manifest field names a field on its *parent*, not on itself --
 * `formManifestFindings` only ever resolves a form's fields against its own
 * scope, so neither is checked anywhere else.
 *
 * Both are unambiguous field references, unlike a `logicCheck` bareword: the
 * app (`parent_id_selector_screen.dart`) parses `entry_condition` as a
 * literal `field=value` pair, never the AND/OR/quoted-literal grammar logic
 * checks use, so there is no "maybe it's meant as a literal" reading to
 * downgrade to a warning for. An unresolvable one isn't inert either -- the
 * parent-record filter compares against a field that is never present, so
 * every record fails the comparison and the picker silently offers zero
 * eligible parents. Both are therefore errors, like `linkingFieldUnknown`.
 */
function parentFieldReferenceFindings(pkg: SurveyPackage): Finding[] {
  const findings: Finding[] = [];
  const byTablename = new Map<string, SurveyForm>();
  for (const form of pkg.forms) {
    const key = form.tablename?.trim().toLowerCase();
    if (key) byTablename.set(key, form);
  }

  for (const form of pkg.forms) {
    if (!form.parenttable) continue;
    const parent = byTablename.get(form.parenttable.trim().toLowerCase());
    if (!parent) continue; // reported by parentChainFindings instead

    const scope = buildFormScope(parent);
    const base = {
      scope: 'form' as const,
      formId: form.id,
      tablename: form.tablename,
      part: 'manifest' as const,
    };

    if (form.repeatCountField && scope.resolve(form.repeatCountField).kind === 'unknown') {
      findings.push({
        ...base,
        ruleId: RULE.repeatCountFieldUnknown,
        severity: 'error',
        subject: form.repeatCountField,
        message: `Repeat count field '${form.repeatCountField}' is not a field on the parent form '${form.parenttable}'.`,
      });
    }

    // Foreign-key viability, which neither this tool nor SurveyGen used to
    // check. The app now creates each child table with
    // `FOREIGN KEY (linkingfield) REFERENCES parent(...) ON UPDATE CASCADE`,
    // so a correction to a parent's key carries to its children instead of
    // splitting a household across two ids. That requires the linking column
    // to exist on the *parent* -- which nothing verified anywhere, because
    // formManifest.ts only ever resolved it against the child's own fields.
    //
    // It deliberately does not require the linking field to be the parent's
    // primary key. A real dictionary links `vaccination_status` to `enrollee`
    // on `barcode` (a scanned physical label) while `enrollee` is keyed on
    // `subjid`, and that is a legitimate shape: the app declares the
    // uniqueness the foreign key needs over whichever columns children
    // actually reference, not only over the primary key.
    if (form.linkingfield) {
      const linkingCols = splitList(form.linkingfield);
      const unknownOnParent = linkingCols.filter(
        (col) => scope.resolve(col).kind === 'unknown',
      );

      if (unknownOnParent.length > 0) {
        findings.push({
          ...base,
          ruleId: RULE.linkingFieldNotOnParent,
          severity: 'error',
          subject: unknownOnParent.join(', '),
          message: `Linking field '${unknownOnParent.join(', ')}' is not a field on the parent form '${form.parenttable}'.`,
          hint: 'A child is matched to its parent by this column, so it has to exist on both forms.',
        });
      }
    }

    if (form.entry_condition) {
      const eq = form.entry_condition.indexOf('=');
      const field = eq === -1 ? form.entry_condition : form.entry_condition.slice(0, eq).trim();
      if (field && scope.resolve(field).kind === 'unknown') {
        findings.push({
          ...base,
          ruleId: RULE.entryConditionUnknown,
          severity: 'error',
          subject: field,
          message: `Entry condition references '${field}', which is not a field on the parent form '${form.parenttable}'.`,
          hint: "The app matches this as a literal 'field=value' pair against the parent's records -- an unresolvable field means no parent record can ever match.",
        });
      }
    }
  }

  return findings;
}

function packageIdentityFindings(pkg: SurveyPackage): Finding[] {
  const findings: Finding[] = [];

  if (!pkg.surveyId || pkg.surveyId.trim() === '') {
    findings.push({
      scope: 'package',
      ruleId: RULE.surveyIdMissing,
      severity: 'error',
      message: 'Survey ID is not set.',
      hint: 'Set it in Survey Settings.',
    });
  }

  if (pkg.databaseName && pkg.databaseName.trim() !== '' && !pkg.databaseName.trim().endsWith('.sqlite')) {
    findings.push({
      scope: 'package',
      ruleId: RULE.databaseNameInvalid,
      severity: 'error',
      subject: pkg.databaseName,
      message: `Database name '${pkg.databaseName}' should end in '.sqlite'.`,
    });
  }

  return findings;
}

/**
 * One fieldname, two forms, two meanings. A linking field recurs by design
 * and a calculated copy of a parent value is common; a question re-asked in
 * a second form with different codes is not -- the export puts both under
 * one column name, so the two look comparable when they are not. A warning:
 * real surveys do this on purpose now and then. Ported from SurveyGen's
 * `_check_fields_consistent_across_forms`.
 */
function fieldRedefinedFindings(pkg: SurveyPackage): Finding[] {
  const findings: Finding[] = [];
  const skipNames = new Set<string>([
    ...LEADING_SYSTEM_FIELDS.map((f) => f.fieldname.toLowerCase()),
    ...TRAILING_SYSTEM_FIELDS.map((f) => f.fieldname.toLowerCase()),
    ...[...KNOWN_AUTOMATIC_FIELDNAMES].map((n) => n.toLowerCase()),
  ]);
  for (const form of pkg.forms) {
    for (const col of splitList(form.linkingfield)) skipNames.add(col.toLowerCase());
  }

  const seen = new Map<string, Array<{ form: SurveyForm; q: SurveyQuestion; signature: string }>>();
  for (const form of pkg.forms) {
    for (const q of form.questions) {
      const key = q.fieldname?.trim().toLowerCase();
      if (!key || skipNames.has(key)) continue;
      if (q.type === 'calculated' || q.type === 'information') continue;
      const codes = (q.responses ?? []).map((r) => r.value).sort();
      const signature = `${q.type}/${q.fieldtype}/${codes.join(',')}`;
      const list = seen.get(key) ?? [];
      list.push({ form, q, signature });
      seen.set(key, list);
    }
  }

  for (const [, uses] of seen) {
    if (uses.length < 2 || new Set(uses.map((u) => u.signature)).size < 2) continue;
    const where = uses.map((u) => `'${u.form.tablename}' (${u.signature})`).join(' and ');
    for (const use of uses) {
      findings.push({
        scope: 'question',
        formId: use.form.id,
        tablename: use.form.tablename,
        questionId: use.q.id,
        questionIndex: use.form.questions.indexOf(use.q),
        fieldname: use.q.fieldname,
        part: 'identity',
        ruleId: RULE.fieldRedefinedAcrossForms,
        severity: 'warning',
        subject: use.q.fieldname,
        message: `'${use.q.fieldname}' is defined differently in ${where}.`,
        hint: 'The same name with different codes makes the two export columns look comparable when they are not. Rename one, or align the codes.',
      });
    }
  }
  return findings;
}

export function packageFindings(pkg: SurveyPackage): Finding[] {
  return [
    ...tablenameFindings(pkg),
    ...parentChainFindings(pkg),
    ...parentFieldReferenceFindings(pkg),
    ...baseFormCountFindings(pkg),
    ...packageIdentityFindings(pkg),
    ...fieldRedefinedFindings(pkg),
  ];
}
