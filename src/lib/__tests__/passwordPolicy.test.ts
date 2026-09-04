import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT } from "../passwordPolicy";

/**
 * The client constant is a hint; `supabase/config.toml` is the rule. This
 * reads the rule out of the file so the two cannot drift -- a raised floor in
 * config.toml with a stale constant would show the user the wrong number and
 * let the form submit a password the Auth service then refuses.
 */
const configToml = readFileSync("supabase/config.toml", "utf8");

function authSetting(name: string): string {
  // Only the [auth] block -- config.toml has other sections and some settings
  // appear commented out elsewhere.
  const match = configToml.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, "m"));
  if (!match) throw new Error(`${name} not found in supabase/config.toml`);
  return match[1].trim();
}

describe("password policy", () => {
  it("matches minimum_password_length in supabase/config.toml", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(Number(authSetting("minimum_password_length")));
  });

  it("is at least the floor create_app_credential enforces on field workers", () => {
    // The two surfaces disagreed before this: 10 for a field credential, 6 for
    // a portal account that can read every project's data.
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(10);
  });

  it("requires re-authentication before a password change", () => {
    // Without this, updateUser({ password }) authorises on the active session
    // alone, so a hijacked session is a full account takeover.
    expect(authSetting("secure_password_change")).toBe("true");
  });

  it("names the number in the message the user actually reads", () => {
    expect(PASSWORD_TOO_SHORT).toContain(String(PASSWORD_MIN_LENGTH));
  });
});
