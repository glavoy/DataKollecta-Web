import type { SurveyPackage } from "@/types/survey";

/**
 * A local safety net for unsaved designer edits. Server saves
 * (`surveyService.saveSurveyPackage`) build a whole zip in-browser, delete
 * the existing storage object, then re-upload -- too expensive and too
 * destructive to run on a timer. This module writes a much cheaper local
 * mirror instead, so a browser crash, an accidental tab close, or (before
 * it was fixed) the auth-driven state reset doesn't erase work that was
 * never given a chance to reach Save Draft.
 */

const SCHEMA_VERSION = 1 as const;

export interface SurveyDraft {
  schema: typeof SCHEMA_VERSION;
  userId: string;
  surveyKey: string;
  /** ISO, client clock. Display only -- staleness is decided by comparing
   *  against `baseServerUpdatedAt`, never by comparing clocks. */
  savedAt: string;
  /** `survey_packages.updated_at` of the server row this draft was taken
   *  on top of, so a restore can tell whether the server has since moved. */
  baseServerUpdatedAt: string | null;
  /** Filenames only -- content is stripped before storage (see below). */
  csvFilenames: string[];
  /** The package with `csvFiles[].content` removed. */
  pkg: SurveyPackage;
}

function draftKey(userId: string, surveyKey: string): string {
  return `dk.draft.v${SCHEMA_VERSION}.${userId}.${surveyKey}`;
}

/**
 * The key a survey is mirrored under. A saved survey has a stable database
 * id; a brand-new one does not -- `SurveyDesignerPage` mints a fresh
 * `crypto.randomUUID()` on every mount for `/surveys/new`, so keying on
 * `pkg.id` would silently orphan the draft on the very next reload. Keying
 * on the project instead means one in-flight "new survey" draft per project
 * per user, which is the right tradeoff for a route with no stable identity.
 */
export function surveyDraftKey(surveyRecordId: string | undefined, projectId: string | null): string {
  return surveyRecordId ? `s:${surveyRecordId}` : `new:${projectId ?? 'unknown'}`;
}

/**
 * `csvFiles[].content` holds full CSV text in memory and can be large
 * enough on its own to blow the ~5MB localStorage quota. It is also fully
 * recoverable from the server (the zip still has it), so it is never
 * mirrored -- only the filenames are kept, to warn on restore if a CSV was
 * added locally and never made it to a save.
 */
export function stripCsvContent(pkg: SurveyPackage): { pkg: SurveyPackage; csvFilenames: string[] } {
  const csvFilenames = (pkg.csvFiles ?? []).map((f) => f.filename);
  if (!pkg.csvFiles || pkg.csvFiles.length === 0) return { pkg, csvFilenames };
  const { csvFiles: _csvFiles, ...rest } = pkg;
  return { pkg: rest as SurveyPackage, csvFilenames };
}

let mirrorDisabled = false;

/**
 * Best-effort write. Failure (quota exceeded, Safari private mode, an
 * unavailable `localStorage`) must never surface as an app error -- this is
 * a backstop, not a feature the user is depending on to see success/failure
 * feedback for.
 */
export function writeDraft(args: {
  userId: string;
  surveyKey: string;
  pkg: SurveyPackage;
  baseServerUpdatedAt: string | null;
}): boolean {
  if (mirrorDisabled) return false;
  try {
    const { pkg, csvFilenames } = stripCsvContent(args.pkg);
    const draft: SurveyDraft = {
      schema: SCHEMA_VERSION,
      userId: args.userId,
      surveyKey: args.surveyKey,
      savedAt: new Date().toISOString(),
      baseServerUpdatedAt: args.baseServerUpdatedAt,
      csvFilenames,
      pkg,
    };
    window.localStorage.setItem(draftKey(args.userId, args.surveyKey), JSON.stringify(draft));
    return true;
  } catch (err) {
    // A half-written key is worse than none, and quota errors mean further
    // writes this session will fail too -- stop trying rather than retry
    // every debounce tick.
    try {
      window.localStorage.removeItem(draftKey(args.userId, args.surveyKey));
    } catch {
      // localStorage itself is unavailable; nothing more to clean up.
    }
    mirrorDisabled = true;
    console.warn('Local draft backup unavailable:', err);
    return false;
  }
}

export function readDraft(userId: string, surveyKey: string): SurveyDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(userId, surveyKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SurveyDraft>;
    if (parsed.schema !== SCHEMA_VERSION || !parsed.pkg) {
      window.localStorage.removeItem(draftKey(userId, surveyKey));
      return null;
    }
    return parsed as SurveyDraft;
  } catch {
    // Corrupt value -- treat as absent rather than throwing during render.
    try {
      window.localStorage.removeItem(draftKey(userId, surveyKey));
    } catch {
      // ignore
    }
    return null;
  }
}

export function clearDraft(userId: string, surveyKey: string): void {
  try {
    window.localStorage.removeItem(draftKey(userId, surveyKey));
  } catch {
    // ignore -- nothing to clean up if storage itself is unavailable
  }
}

const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Sweeps stale or unrecognized draft entries. Call once per designer mount. */
export function pruneDrafts(now: number = Date.now()): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith('dk.draft.v')) continue;
      try {
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? (JSON.parse(raw) as Partial<SurveyDraft>) : null;
        const savedAtMs = parsed?.savedAt ? Date.parse(parsed.savedAt) : NaN;
        if (parsed?.schema !== SCHEMA_VERSION || Number.isNaN(savedAtMs) || now - savedAtMs > MAX_DRAFT_AGE_MS) {
          toRemove.push(key);
        }
      } catch {
        toRemove.push(key); // unparsable -- remove
      }
    }
    toRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // localStorage unavailable -- nothing to prune
  }
}

export type DraftOffer =
  | { kind: 'none' }
  | { kind: 'redundant'; draft: SurveyDraft }
  | { kind: 'offer'; draft: SurveyDraft; staleBase: boolean };

/**
 * Decides what to do with a found draft, given the package that was just
 * loaded from the server. Deliberately never compares clocks -- `savedAt`
 * is the browser's clock and clock skew is exactly what causes the data
 * loss this module exists to soften, so `baseServerUpdatedAt` (Postgres's
 * clock, opaque to us) is the only thing ever compared.
 */
export function evaluateDraft(draft: SurveyDraft | null, serverPkg: SurveyPackage, serverUpdatedAt: string | null): DraftOffer {
  if (!draft) return { kind: 'none' };
  const { pkg: serverStripped } = stripCsvContent(serverPkg);
  if (JSON.stringify(draft.pkg) === JSON.stringify(serverStripped)) {
    return { kind: 'redundant', draft };
  }
  const staleBase = draft.baseServerUpdatedAt !== serverUpdatedAt;
  return { kind: 'offer', draft, staleBase };
}
