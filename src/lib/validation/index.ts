/**
 * The validation engine's entry point.
 *
 * `validatePackage` is what `SurveyDesigner` calls (via `useMemo`, keyed on
 * the package object) to get the full picture: every form's questions
 * checked against every rule module, rolled into one `ValidationReport`.
 *
 * Rule modules land incrementally -- see the plan this engine was built
 * from. This currently wires only `rules/references.ts`, the reference
 * integrity/ordering group, since it is both the highest-value rule set
 * (SurveyGen's own ordering/reference checks, plus new coverage it has no
 * equivalent for) and the one that would have caught the incident that
 * motivated building this at all. The remaining modules (identity, shape,
 * responses, calculation, formManifest, packageRules) are added the same way
 * as they land.
 */

import type { SurveyPackage } from '@/types/survey';
import { buildReport, type Finding, type ValidationReport } from './types';
import { referenceFindings } from './rules/references';

export function validatePackage(pkg: SurveyPackage): ValidationReport {
  const findings: Finding[] = [];

  for (const form of pkg.forms) {
    findings.push(...referenceFindings(form));
  }

  return buildReport(findings);
}

export * from './types';
