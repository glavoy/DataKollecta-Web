/**
 * The validation engine's entry point.
 *
 * `validatePackage` is what `SurveyDesigner` calls (via `useMemo`, keyed on
 * the package object) to get the full picture: every form's questions
 * checked against every rule module, rolled into one `ValidationReport`.
 *
 * Rule modules land incrementally -- see the plan this engine was built
 * from. Still missing: formManifest.ts and packageRules.ts (cross-form
 * concerns SurveyGen has no equivalent for at all, since it only ever
 * validates one worksheet in isolation).
 */

import type { SurveyPackage } from '@/types/survey';
import { buildReport, type Finding, type ValidationReport } from './types';
import { referenceFindings } from './rules/references';
import { identityFindings } from './rules/identity';
import { shapeFindings } from './rules/shape';
import { responsesFindings } from './rules/responses';
import { calculationFindings } from './rules/calculation';

export function validatePackage(pkg: SurveyPackage): ValidationReport {
  const findings: Finding[] = [];
  const csvFilenames = new Set((pkg.csvFiles ?? []).map((f) => f.filename));

  for (const form of pkg.forms) {
    findings.push(...identityFindings(form));
    findings.push(...shapeFindings(form));
    findings.push(...responsesFindings(form, csvFilenames));
    findings.push(...calculationFindings(form));
    findings.push(...referenceFindings(form));
  }

  return buildReport(findings);
}

export * from './types';
