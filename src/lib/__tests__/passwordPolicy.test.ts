import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT } from "../passwordPolicy";

/**
 * The client constant is a hint; `supabase/config.toml` is the rule. This
 * reads the rule out of the file so the two cannot drift -- a raised floor in
 * config.toml with a stale constant would show the user the wrong number and
 * let the form submit a password the Auth service then refuses.
 *
 * config.toml is also what `supabase config push` sends to production, so the
 * value read here is production's, not just the local stack's.
 */
const configToml = readFileSync("supabase/config.toml", "utf8");

/**
 * The base `[auth]` tree: from the `[auth]` header to the first section header
 * that is not an `[auth.*]` subtable.
 *
 * This used to be a bare `/m` regex over the whole 17 KB file, under a comment
 * claiming an `[auth]` scope it did not implement. That was harmless only
 * because each key happened to occur once. It stopped being harmless when
 * `[remotes.production.auth]` was added: a key set in both places would be
 * read from whichever came first in the file, which is not necessarily the one
 * that governs the stack under test.
 */
function baseAuthBlock(): string {
  const lines = configToml.split("\n");
  const start = lines.findIndex((line) => line.trim() === "[auth]");
  if (start === -1) throw new Error("[auth] section not found in supabase/config.toml");

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("[") && !line.startsWith("[auth.")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const authBlock = baseAuthBlock();

function authSetting(name: string): string {
  const match = authBlock.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, "m"));
  if (!match) throw new Error(`${name} not found in the [auth] block of supabase/config.toml`);
  return match[1].trim();
}

/** Everything from the first `[remotes...]` header to the end of the file. */
function remoteOverrides(): string {
  const index = configToml.search(/^\[remotes[.\]]/m);
  return index === -1 ? "" : configToml.slice(index);
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

  it("is not overridden per-environment by a [remotes.*] block", () => {
    // `config push` merges [remotes.<name>] over the base config, so an
    // override here would send production a different policy from the one the
    // assertions above pin -- and this file, and passwordPolicy.ts, would
    // quietly be describing only the local stack again. site_url and
    // additional_redirect_urls are the only settings that may differ.
    for (const key of ["minimum_password_length", "password_requirements", "secure_password_change"]) {
      expect(remoteOverrides()).not.toMatch(new RegExp(`^\\s*${key}\\s*=`, "m"));
    }
  });
});
