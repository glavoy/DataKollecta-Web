/**
 * Upgrading questions stored in `crfs.fields` to the current model.
 *
 * Packages saved before the type model gained recursive calculations, an
 * explicit response mode and a separated fixed-length flag are upgraded lazily
 * on read, so there is no database migration to run and no stored shape that
 * silently emits wrong XML.
 */

import type { CalculationConfig, SurveyQuestion } from '@/types/survey';
import { constantOf } from '@/types/survey';
import { normalizeCalculation } from './calculation';

/** The pre-recursive shape: string results, `elseResult`, no `parts`. */
interface LegacyCalculation {
  cases?: Array<Record<string, unknown>>;
  elseResult?: unknown;
  [key: string]: unknown;
}

function upgradeCalculation(raw: unknown): CalculationConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const legacy = { ...(raw as LegacyCalculation) };

  if (Array.isArray(legacy.cases)) {
    legacy.cases = legacy.cases.map((k, i) => {
      const kase = { ...k };
      // Results used to be plain strings.
      if (typeof kase.result === 'string') kase.result = constantOf(kase.result);
      else if (kase.result && typeof kase.result === 'object') {
        kase.result = upgradeCalculation(kase.result);
      } else {
        kase.result = constantOf('');
      }
      if (kase.id === undefined) kase.id = `case-${i}`;
      return kase;
    });
  }

  if (legacy.elseResult !== undefined) {
    legacy.defaultResult =
      typeof legacy.elseResult === 'string'
        ? constantOf(legacy.elseResult)
        : upgradeCalculation(legacy.elseResult);
    delete legacy.elseResult;
  }

  if (Array.isArray(legacy.parts)) {
    legacy.parts = legacy.parts.map((p) => upgradeCalculation(p)).filter(Boolean);
  }

  return normalizeCalculation(legacy as unknown as CalculationConfig);
}

/** The stored shape, before this module tightens it up. */
type StoredQuestion = Omit<SurveyQuestion, 'maxCharacters'> & {
  maxCharacters?: number | string;
};

function upgradeQuestion(raw: unknown): SurveyQuestion {
  const q = { ...(raw as object) } as StoredQuestion;

  // maxCharacters used to hold the raw '=3' string.
  if (typeof q.maxCharacters === 'string') {
    const t = q.maxCharacters.trim();
    const fixed = t.startsWith('=');
    const n = Number(fixed ? t.slice(1) : t);
    if (Number.isFinite(n)) {
      q.maxCharacters = n;
      if (fixed) q.fixedLength = true;
    } else {
      delete q.maxCharacters;
    }
  }

  // Both response blocks could previously be set at once; the app reads only
  // the first emitted, so pick one explicitly rather than leaving it to order.
  if (!q.responseMode) {
    q.responseMode = q.dynamicResponses ? 'dynamic' : 'static';
  }

  if (q.calculation) {
    const upgraded = upgradeCalculation(q.calculation);
    if (upgraded) q.calculation = upgraded;
    else delete q.calculation;
  }

  return q as SurveyQuestion;
}

export function normalizeStoredQuestions(raw: unknown): SurveyQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(upgradeQuestion);
}
