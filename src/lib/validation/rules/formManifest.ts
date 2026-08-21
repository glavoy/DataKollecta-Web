/**
 * Per-form manifest field references: primary key, display fields,
 * increment field, ID-config field names, and the linking field to a
 * parent form -- each must actually name a field declared on this form.
 *
 * No SurveyGen equivalent. `crf_reader.py` (SurveyGen's `crfs`-worksheet
 * reader) does zero validation of its own: malformed `idconfig` JSON is
 * swallowed by a bare `except Exception: crf.idconfig = None`, and nothing
 * checks that `linkingfield` or `primarykey` name a real column. This is
 * genuinely new ground.
 */

import type { SurveyForm } from '@/types/survey';
import { RULE, type Finding } from '../types';
import { buildFormScope } from '../scope';

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formManifestFindings(form: SurveyForm): Finding[] {
  const scope = buildFormScope(form);
  const findings: Finding[] = [];
  const base = { scope: 'form' as const, part: 'manifest' as const };

  const checkNames = (names: string[], label: string) => {
    for (const name of names) {
      if (scope.resolve(name).kind === 'unknown') {
        findings.push({
          ...base,
          ruleId: RULE.manifestFieldUnknown,
          severity: 'error',
          subject: name,
          message: `${label} names '${name}', which is not a field on this form.`,
        });
      }
    }
  };

  checkNames(splitList(form.primaryKey), 'Primary key');
  checkNames(splitList(form.displayFields), 'Display fields');
  if (form.incrementField) checkNames([form.incrementField], 'Increment field');
  for (const f of form.idconfig?.fields ?? []) {
    if (f.name) checkNames([f.name], 'ID config field');
  }

  if (form.parenttable) {
    if (!form.linkingfield) {
      findings.push({
        ...base,
        ruleId: RULE.linkingFieldMissing,
        severity: 'error',
        message: `This form has a parent table ('${form.parenttable}') but no linking field.`,
        hint: 'Set a linking field so records can be matched to their parent.',
      });
    } else if (scope.resolve(form.linkingfield).kind === 'unknown') {
      findings.push({
        ...base,
        ruleId: RULE.linkingFieldUnknown,
        severity: 'error',
        subject: form.linkingfield,
        message: `Linking field '${form.linkingfield}' is not a field on this form.`,
      });
    }
  }

  return findings.map((f) => ({ ...f, formId: form.id, tablename: form.tablename }));
}
