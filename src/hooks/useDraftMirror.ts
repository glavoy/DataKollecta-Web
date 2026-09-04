import { useEffect, useRef } from "react";
import type { SurveyPackage } from "@/types/survey";
import { writeDraft } from "@/lib/draftStorage";

/**
 * Mirrors `pkg` to localStorage on a short idle debounce while `enabled`
 * (dirty edits, a resolvable user and survey key). A single `setTimeout`
 * per change is enough here -- this has exactly one caller, so a generic
 * debounce utility would be speculative machinery for no real reuse.
 */
export function useDraftMirror(args: {
  enabled: boolean;
  pkg: SurveyPackage;
  userId: string | undefined;
  surveyKey: string | undefined;
  baseServerUpdatedAtRef: React.MutableRefObject<string | null>;
  delayMs?: number;
}): void {
  const { enabled, pkg, userId, surveyKey, baseServerUpdatedAtRef, delayMs = 1000 } = args;

  // pkg changes identity on every keystroke-driven edit; reading it via a
  // ref inside the timeout (rather than closing over the effect's own copy)
  // means a burst of edits within the debounce window all collapse into one
  // write of the *latest* state instead of scheduling N writes.
  const pkgRef = useRef(pkg);
  pkgRef.current = pkg;

  useEffect(() => {
    if (!enabled || !userId || !surveyKey) return;

    const timer = window.setTimeout(() => {
      writeDraft({
        userId,
        surveyKey,
        pkg: pkgRef.current,
        baseServerUpdatedAt: baseServerUpdatedAtRef.current,
      });
    }, delayMs);

    return () => window.clearTimeout(timer);
    // `pkg` is in the deps although the timer reads it through pkgRef: a
    // change to it alone still has to reset the debounce, or an edit made
    // inside the delay window would never be written. exhaustive-deps is
    // satisfied by that, so the disable this line used to carry was dead.
  }, [enabled, userId, surveyKey, pkg, delayMs, baseServerUpdatedAtRef]);
}
