/**
 * The single most important test in this suite.
 *
 * A genuine SurveyGen-produced survey, parsed through the real pipeline,
 * must validate clean. If it doesn't, the rule that fires is wrong -- this
 * fixture cannot be quietly bent to make a rule pass the way a hand-authored
 * one could.
 */

import { describe, it, expect } from 'vitest';
import { validatePackage } from '..';
import { buildRealPackage } from '../__fixtures__/realPackage';

describe('a real SurveyGen package', () => {
  const pkg = buildRealPackage();
  const report = validatePackage(pkg);

  it('actually loaded real question lists -- guards against a broken fixture path passing for the wrong reason', () => {
    expect(pkg.forms).toHaveLength(2);
    for (const form of pkg.forms) {
      expect(form.questions.length).toBeGreaterThan(10);
    }
  });

  it('produces no findings at all', () => {
    if (report.findings.length > 0) {
      // A failure here should show exactly what fired and why, not just a
      // diff -- this list IS the false-positive inventory to fix.
      const summary = report.findings
        .map((f) => `${f.severity.toUpperCase()} ${f.ruleId} [${f.tablename ?? 'package'}${f.fieldname ? '/' + f.fieldname : ''}] ${f.message}`)
        .join('\n');
      throw new Error(`Expected zero findings on a real SurveyGen package. Got:\n${summary}`);
    }
    expect(report.findings).toEqual([]);
  });
});
