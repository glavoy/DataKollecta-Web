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
 * What the two config settings actually do, measured against a local stack
 * rather than inferred -- because the obvious worry is that raising a floor
 * locks people out, and it does not:
 *
 * | probe | result |
 * |---|---|
 * | existing account with a 6-char password signs in | **works** -- sign-in never checks length |
 * | signing UP with 6 characters | refused, 422 "Password should be at least 10 characters" |
 * | admin API creating a 6-char account | allowed -- it bypasses the policy |
 * | forgot-password link, then set a new password | **works** -- recovery is not blocked |
 * | field worker with a 6-char password on the phone app | **works** -- separate credential system |
 * | change password, session 23h old | allowed |
 * | change password, session 25h old | refused, `reauthentication_needed` |
 *
 * That last pair is the one with a UI consequence: `secure_password_change`
 * gives a 24-hour window, after which the Auth service refuses the change.
 * `AccountPage` catches it and tells the user to sign out and back in, which
 * is the whole remedy -- signing in requires the current password, which is
 * exactly the proof the setting asks for.
 *
 * Composition rules were considered and rejected on evidence, not taste.
 * Measured against a local stack, BOTH of Supabase's stricter options reject
 * `correct horse battery staple` (28 characters, for want of a digit) and
 * accept `Password1!` -- so the rule refuses the strong password and waves
 * through the one in every cracking wordlist. That is why NIST SP 800-63B
 * recommends against composition rules outright. Length is the lever here.
 *
 * The setting that WOULD catch `Password1!` is Supabase's leaked-password
 * check (HaveIBeenPwned). It requires the Pro plan, which this project is not
 * on, so it is unavailable rather than declined -- worth revisiting if the
 * plan changes. MFA (see the portal's ToDo.md) is worth more than all of
 * this combined, since it is the only one that survives a stolen password.
 *
 * Field-worker credentials are untouched by any of this. The phone app goes
 * through the `app-login` Edge Function to `verify_app_credential`, which
 * bcrypts against `app_credentials`; Supabase Auth is not in that path, and
 * its own 10-character floor lives in `create_app_credential`.
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
