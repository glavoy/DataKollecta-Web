import { describe, expect, it } from "vitest";
import { getErrorCode, getErrorDetails, isUniqueViolation } from "../postgrestError";

/** The shape Supabase actually rejects with: a plain object, not an Error. */
const uniqueViolation = {
  message: 'duplicate key value violates unique constraint "projects_slug_key"',
  details: "Key (slug)=(my-project) already exists.",
  hint: null,
  code: "23505",
};

describe("getErrorCode", () => {
  it("reads a PostgrestError's SQLSTATE", () => {
    expect(getErrorCode(uniqueViolation)).toBe("23505");
  });

  it("is undefined for an ordinary Error", () => {
    // The callers all branch on the code, so a thrown Error must fall through
    // to the generic message rather than matching some default.
    expect(getErrorCode(new Error("boom"))).toBeUndefined();
  });

  it("is undefined for null, a string, and an object with no code", () => {
    expect(getErrorCode(null)).toBeUndefined();
    expect(getErrorCode("23505")).toBeUndefined();
    expect(getErrorCode({ message: "no code here" })).toBeUndefined();
  });

  it("ignores a non-string code rather than coercing it", () => {
    expect(getErrorCode({ code: 23505 })).toBeUndefined();
  });
});

describe("getErrorDetails", () => {
  it("reads the details, which name the constraint", () => {
    expect(getErrorDetails(uniqueViolation)).toBe("Key (slug)=(my-project) already exists.");
  });

  it("is undefined when details is null", () => {
    // Postgrest sends null, not an empty string, when there are none.
    expect(getErrorDetails({ code: "23505", details: null })).toBeUndefined();
  });
});

describe("isUniqueViolation", () => {
  it("matches on the SQLSTATE", () => {
    expect(isUniqueViolation(uniqueViolation)).toBe(true);
  });

  it("matches on the message when the code did not survive", () => {
    // Supabase sometimes wraps the error, which is why the message is checked
    // too -- the credential editor relied on exactly this fallback.
    expect(isUniqueViolation(new Error("duplicate key value violates ..."))).toBe(true);
  });

  it("is case-insensitive about the message", () => {
    expect(isUniqueViolation({ message: "Duplicate Key value" })).toBe(true);
  });

  it("does not match an unrelated failure", () => {
    expect(isUniqueViolation({ message: "permission denied", code: "42501" })).toBe(false);
    expect(isUniqueViolation(new Error("network error"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
