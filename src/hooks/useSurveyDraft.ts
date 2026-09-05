import { useEffect, useRef, useState } from "react";

import { SurveyPackage } from "@/types/survey";
import { useDraftMirror } from "@/hooks/useDraftMirror";
import {
  surveyDraftKey,
  readDraft,
  clearDraft,
  evaluateDraft,
  type SurveyDraft,
} from "@/lib/draftStorage";

interface UseSurveyDraftArgs {
  initialPackage?: SurveyPackage;
  serverUpdatedAt?: string | null;
  surveyRecordId?: string;
  projectId?: string | null;
  userId?: string;
  /** Used only when `initialPackage` is absent, to seed a brand-new survey. */
  makeEmptyPackage: () => SurveyPackage;
}

/**
 * Owns the edited package and everything that keeps it from being lost.
 *
 * Split out of `SurveyDesigner.tsx`. These seven pieces of state exist only to
 * serve each other: the package, which form is open, whether it is dirty, the
 * staleness token, the offered draft, and two one-shot guards. Nothing else in
 * the designer touches them directly.
 *
 * Follows the pair this repo already uses -- `useDraftMirror` for timing plus
 * `lib/draftStorage.ts` for policy. This hook is the lifecycle around them and
 * adds no policy of its own.
 *
 * **`dirty` is a write-flag, not a diff.** Nothing here deep-compares the
 * package against what the server holds. It is set on every edit and cleared
 * only by adopting a freshly-loaded survey or by a successful save. Making it a
 * comparison would change when the mirror runs and when the tab-close warning
 * appears.
 *
 * **No toasts live in here.** `discardDraft` returns whether it actually
 * discarded so the caller can decide what to say; the locked-edit bounce stays
 * in the component. A hook that reaches for `useToast` starts owning UI copy.
 */
export function useSurveyDraft({
  initialPackage,
  serverUpdatedAt,
  surveyRecordId,
  projectId,
  userId,
  makeEmptyPackage,
}: UseSurveyDraftArgs) {
  const [surveyPackage, setSurveyPackage] = useState<SurveyPackage>(
    () => initialPackage ?? makeEmptyPackage(),
  );

  const [activeFormId, setActiveFormId] = useState<string>(
    surveyPackage.forms[0]?.id || "",
  );

  // True whenever `surveyPackage` holds edits the project doesn't have.
  // Drives the Save Draft/Publish affordance, the local draft mirror, and
  // the unsaved-changes warning on tab close -- cleared only on a
  // successful server save or when a freshly-loaded survey is adopted.
  const [dirty, setDirty] = useState(false);

  // The server's `updated_at` for whatever is currently the "clean"
  // baseline -- reset on load and after every successful save. This is what
  // the draft mirror stamps a local draft with, and what a later restore
  // compares against to know whether the server has moved on since.
  const baseServerUpdatedAtRef = useRef<string | null>(serverUpdatedAt ?? null);

  const surveyKey = surveyDraftKey(surveyRecordId, projectId ?? null);
  const [pendingDraft, setPendingDraft] = useState<{
    draft: SurveyDraft;
    staleBase: boolean;
  } | null>(null);
  // Guards against the restore/discard dialog's own close animation firing
  // its onOpenChange a second time after an explicit button already handled
  // the choice -- see discardDraft.
  const draftHandledRef = useRef(false);

  // Adopt `initialPackage` only when the survey it represents actually
  // changes -- keyed on the package's own id, not on the prop's object
  // identity. A parent re-render that hands down the *same* survey again
  // (a token refresh used to do exactly this) must never overwrite whatever
  // the user has typed since. See AuthContext/SurveyDesignerPage for the
  // upstream fixes that make this a defense-in-depth guard rather than the
  // only thing standing between a refresh and lost work.
  const adoptedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialPackage) return;
    if (adoptedIdRef.current === initialPackage.id) return;
    adoptedIdRef.current = initialPackage.id;

    setSurveyPackage(initialPackage);
    setActiveFormId(initialPackage.forms[0]?.id ?? "");
    setDirty(false);
    baseServerUpdatedAtRef.current = serverUpdatedAt ?? null;

    if (!userId) return;
    const draft = readDraft(userId, surveyKey);
    const evaluation = evaluateDraft(draft, initialPackage, serverUpdatedAt ?? null);
    if (evaluation.kind === "redundant") {
      clearDraft(userId, surveyKey);
    } else if (evaluation.kind === "offer") {
      draftHandledRef.current = false;
      setPendingDraft({ draft: evaluation.draft, staleBase: evaluation.staleBase });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on initialPackage/serverUpdatedAt only; userId/surveyKey are read for the one-time draft check on adoption, not meant to re-run this
  }, [initialPackage, serverUpdatedAt]);

  useDraftMirror({
    enabled: dirty && !!userId,
    pkg: surveyPackage,
    userId,
    surveyKey,
    baseServerUpdatedAtRef,
  });

  // A close/refresh within the draft mirror's debounce window is the one
  // gap it can't cover on its own.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /** Merges an edit into the package and marks it unsaved.
   *
   *  Takes a partial or an updater, functional either way, so a burst of edits
   *  in one tick never silently drops one the way spreading over a captured
   *  `surveyPackage` would. The caller owns the guards -- the locked-survey
   *  bounce lives in the component, next to its toast. */
  const applyEdit = (
    next: Partial<SurveyPackage> | ((prev: SurveyPackage) => Partial<SurveyPackage>),
  ) => {
    setSurveyPackage(prev => ({
      ...prev,
      ...(typeof next === "function" ? next(prev) : next),
    }));
    setDirty(true);
  };

  /** After a successful server save: clean, new baseline, no local copy. */
  const markSaved = (updatedAt: string | null) => {
    setDirty(false);
    baseServerUpdatedAtRef.current = updatedAt;
    if (userId) clearDraft(userId, surveyKey);
  };

  const restoreDraft = () => {
    if (!pendingDraft || draftHandledRef.current) return;
    draftHandledRef.current = true;
    const { draft } = pendingDraft;
    const restored: SurveyPackage = {
      ...draft.pkg,
      csvFiles: (surveyPackage.csvFiles ?? []).filter(f =>
        draft.csvFilenames.includes(f.filename),
      ),
    };
    setSurveyPackage(restored);
    setActiveFormId(restored.forms[0]?.id ?? "");
    setDirty(true); // restored work is still unsaved
    if (userId) clearDraft(userId, surveyKey);
    setPendingDraft(null);
  };

  /**
   * Returns true when a draft was actually discarded, so the caller knows
   * whether to say so.
   *
   * AlertDialogAction/Cancel both close the dialog themselves, which also
   * fires the AlertDialog's onOpenChange(false) -- without the guard,
   * confirming Restore would run this discard path a beat later and show
   * "Local copy discarded" even though the restore just succeeded. Reset
   * alongside `pendingDraft` whenever a new offer starts.
   */
  const discardDraft = (): boolean => {
    if (draftHandledRef.current) return false;
    draftHandledRef.current = true;
    if (userId) clearDraft(userId, surveyKey);
    setPendingDraft(null);
    return true;
  };

  return {
    surveyPackage,
    activeFormId,
    setActiveFormId,
    dirty,
    applyEdit,
    markSaved,
    pendingDraft,
    restoreDraft,
    discardDraft,
  };
}
