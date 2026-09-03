import { describe, expect, it } from "vitest";
import { getErrorMessage } from "../getErrorMessage";

describe("getErrorMessage", () => {
  it("reads an Error's message", () => {
    expect(getErrorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("reads a Supabase-style plain object", () => {
    // PostgrestError is not an Error instance. Missing this is what would
    // make every failed query report the generic fallback instead of the
    // reason.
    const postgrestError = {
      message: 'duplicate key value violates unique constraint "x"',
      details: "",
      hint: "",
      code: "23505",
    };
    expect(getErrorMessage(postgrestError, "fallback")).toBe(
      'duplicate key value violates unique constraint "x"'
    );
  });

  it("passes a thrown string through", () => {
    expect(getErrorMessage("just a string", "fallback")).toBe("just a string");
  });

  it("falls back for an Error with an empty message", () => {
    expect(getErrorMessage(new Error(""), "fallback")).toBe("fallback");
  });

  it("falls back for an object whose message is not a string", () => {
    expect(getErrorMessage({ message: 42 }, "fallback")).toBe("fallback");
  });

  it("falls back for null, undefined and unrelated values", () => {
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
    expect(getErrorMessage(undefined, "fallback")).toBe("fallback");
    expect(getErrorMessage(0, "fallback")).toBe("fallback");
    expect(getErrorMessage([], "fallback")).toBe("fallback");
  });

  it("keeps a subclass's message", () => {
    class SurveyLockedish extends Error {}
    expect(getErrorMessage(new SurveyLockedish("locked"), "fallback")).toBe("locked");
  });
});
