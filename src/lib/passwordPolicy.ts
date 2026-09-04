/**
 * The portal's password floor, in one place.
 *
 * **The server is the policy, not this file.** Enforcement lives in
 * `supabase/config.toml` (`[auth] minimum_password_length`), because these
 * pages are client-side React and anyone can call
 * `supabase.auth.updateUser({ password })` directly -- a length check in a
 * component is a hint, not a rule. This constant exists so the hint agrees
 * with the rule instead of drifting from it, and
 * `__tests__/passwordPolicy.test.ts` reads the value straight out of
 * `config.toml` to keep the two pinned together.
 *
 * 10 matches the floor `create_app_credential` enforces on field-worker
 * credentials. The two surfaces used to disagree, with the weaker rule on the
 * portal account -- the one that can read every project's collected data.
 *
 * **Only for the sites that SET a password**: sign-up, password reset, and the
 * account page. Never put it on a sign-in field. The password box on
 * `Login.tsx` is rendered in both modes, and a `minLength` there applies to
 * signing *in*, which would lock out every existing account whose password
 * predates this floor -- including yours.
 */
export const PASSWORD_MIN_LENGTH = 10;

/** The message shown when a password is too short. One wording, everywhere. */
export const PASSWORD_TOO_SHORT = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
