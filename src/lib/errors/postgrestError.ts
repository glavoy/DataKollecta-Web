/**
 * Reads the fields Supabase's `PostgrestError` carries beyond `message`.
 *
 * A rejected query rejects with a **plain object** — `{ message, details,
 * hint, code }` — not an `Error` instance. So `catch (error)` gives `unknown`,
 * `error instanceof Error` is false, and reaching for `error.code` directly is
 * a type error under `strict`. These are the narrowings that were previously
 * hidden behind `catch (error: any)`.
 *
 * `code` matters because the callers branch on it: `23505` is
 * `unique_violation`, which is how a duplicate project slug or a repeated
 * field-worker username is told apart from a genuine failure and turned into a
 * message a person can act on.
 *
 * Deliberately returns `undefined` rather than throwing or defaulting: a value
 * that is not a Postgrest error simply has no code, and every caller already
 * has a fallback path for that.
 */
function field(error: unknown, name: string): string | undefined {
  if (error === null || typeof error !== "object" || !(name in error)) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

/** The SQLSTATE code, e.g. `23505` for a unique violation. */
export function getErrorCode(error: unknown): string | undefined {
  return field(error, "code");
}

/** Postgrest's `details`, which names the constraint on a violation. */
export function getErrorDetails(error: unknown): string | undefined {
  return field(error, "details");
}

/** True when the error is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return getErrorCode(error) === "23505" ||
    /duplicate key/i.test(field(error, "message") ?? "");
}
