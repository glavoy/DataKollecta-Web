/**
 * Cross-form concerns: unique table names, the parent/child relationship
 * between forms, exactly one base form, and basic package identity.
 *
 * No SurveyGen equivalent at all -- it validates one worksheet at a time and
 * never sees the relationships between them. The designer has real
 * multi-table surveys (a household form linking to a member form, etc.),
 * and none of this was checked before.
 */

import type { SurveyForm, SurveyPackage } from '@/types/survey';
import { RULE, type Finding } from '../types';
import { isBaseForm } from '@/lib/xml/manifest';

const TABLENAME_RE = /^[a-z_][a-z0-9_]*$/;

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

export function packageFindings(pkg: SurveyPackage): Finding[] {
  return [
    ...tablenameFindings(pkg),
    ...parentChainFindings(pkg),
    ...baseFormCountFindings(pkg),
    ...packageIdentityFindings(pkg),
  ];
}
