/**
 * Pulls a human-readable message out of a caught value.
 *
 * Every `catch` in this codebase used to be typed with an explicit `any` and
 * reach straight for `error.message`, which is why
 * `@typescript-eslint/no-explicit-any` accounted for 38 of the 42 lint
 * errors. `catch (error)` gives `unknown`, and this is the one place that
 * knows how to narrow it.
 *
 * It deliberately handles more than `Error`: Supabase's `PostgrestError` is a
 * **plain object** with a `message` field, not an `Error` instance, so an
 * `instanceof Error` check alone would silently fall through to the fallback
 * for the most common failure in this app -- a rejected query.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  if (error !== null && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return fallback;
}
