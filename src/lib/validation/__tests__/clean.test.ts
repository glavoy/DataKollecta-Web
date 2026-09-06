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
import { RULE } from '../types';
import { buildRealPackage } from '../__fixtures__/realPackage';

/**
 * Warnings this real package is known to earn. Each is a fact about the
 * study, not a false positive: AVERT asks `vx_card_no` and
 * `vx_doses_received_rtss` in both forms with different code lists, and
 * SurveyGen warns about exactly the same two. Enumerated by field so a new
 * warning on this package still fails the test.
 */
const KNOWN_WARNINGS = new Map<string, Set<string>>([
  [RULE.fieldRedefinedAcrossForms, new Set(['vx_card_no', 'vx_doses_received_rtss'])],
]);

describe('a real SurveyGen package', () => {
  const pkg = buildRealPackage();
  const report = validatePackage(pkg);

  it('actually loaded real question lists -- guards against a broken fixture path passing for the wrong reason', () => {
    expect(pkg.forms).toHaveLength(2);
    for (const form of pkg.forms) {
      expect(form.questions.length).toBeGreaterThan(10);
    }
  });

  it('produces no findings beyond the known warnings', () => {
    const unexpected = report.findings.filter(
      (f) => !(f.severity === 'warning' && KNOWN_WARNINGS.get(f.ruleId)?.has(f.fieldname ?? '')),
    );
    if (unexpected.length > 0) {
      // A failure here should show exactly what fired and why, not just a
      // diff -- this list IS the false-positive inventory to fix.
      const summary = unexpected
        .map((f) => `${f.severity.toUpperCase()} ${f.ruleId} [${f.tablename ?? 'package'}${f.fieldname ? '/' + f.fieldname : ''}] ${f.message}`)
        .join('\n');
      throw new Error(`Expected no unexpected findings on a real SurveyGen package. Got:\n${summary}`);
    }
    expect(unexpected).toEqual([]);
    expect(report.hasErrors).toBe(false);
  });

  it('earns exactly the known cross-form warnings', () => {
    const redefined = report.findings.filter((f) => f.ruleId === RULE.fieldRedefinedAcrossForms);
    expect(new Set(redefined.map((f) => f.fieldname))).toEqual(KNOWN_WARNINGS.get(RULE.fieldRedefinedAcrossForms));
  });
});
