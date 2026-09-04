# Edge Function tests

35 HTTP-level tests covering `app-login` and `app-sync` — password
verification, session validation, project-access revocation, and every mobile
write. These are the highest-consequence code in the platform and, until this
suite existed, the only part with no tests at all: `npx vitest run` covers 391
cases and every one of them is a pure function in `src/lib/`.

## Running them

They need a local stack **and** the functions served, in two terminals:

```bash
supabase start && supabase db reset
```

```bash
supabase functions serve --no-verify-jwt
```

Then:

```bash
npm run test:functions
```

`--no-verify-jwt` matters: the tests call with the anon key exactly as the
Flutter client does, and both functions authenticate the caller themselves
(a session token, or a project code and password) rather than relying on the
gateway.

### Prerequisites

- **Deno.** There is no dependency on a system install — `npm run test:functions`
  runs `npx deno`, which fetches it on demand.
- **`psql`**, on `PATH`. Used only for the few things PostgREST cannot reach:
  creating `auth.users` rows, writing a deliberately legacy password hash, and
  reading `pg_stat_statements`. Everything else goes through the same client
  the application uses.

## What they are, and what they are not

They are **HTTP-level tests against a real database**. They build real rows,
call the function over its real URL, and assert on the status and body a field
device would actually receive.

That is deliberate. Everything worth testing in these two functions lives in
the seam between Deno, PostgREST and the SQL in the migrations, and a unit test
with a mocked Supabase client would exercise none of it. It is also exactly
where the bugs this suite is built around lived:

- a `.maybeSingle()` that returns **406** when two rows match, which the
  function read as "package not found" for every submission of that survey;
- a `crypt()` call that has to run on *every* path, including the one where no
  credential matched, or a missing username returns measurably faster than a
  wrong password;
- a foreign key that cascades — except for the second, redundant one on the
  same column, which does not.

That last one was found by this suite, in its own teardown: the single test
that writes a `formchanges` row was the only one that failed to clean up. See
`20260904060000_drop_duplicate_formchanges_project_fk.sql`.

## Isolation

Every test builds its own project, credential, survey package and session,
suffixed with a random string, and deletes them afterwards. The suite can be
run repeatedly against a stack that already holds real data without disturbing
it.

One shared piece of state cannot be namespaced: `app_login_attempts` counts
**per IP** as well as per username, at 50 failures per 15 minutes, and every
test here calls from 127.0.0.1. The suite deliberately generates about twenty
failures a run, so two or three runs in a row would trip that limit and every
subsequent test would fail at login with "Too many failed sign-in attempts" —
which looks like a broken function rather than a saturated counter. `warmUp()`
therefore clears the table at the start of each run, and the tests that
generate failures clear up after themselves. The per-IP mechanism itself is
asserted on directly, so clearing the table cannot quietly hide its removal.

## Known local-only caveat

`app-login`'s CORS test is permissive about `Access-Control-Allow-Origin`,
because the local Kong gateway applies its own `cors` plugin to the
`functions-v1` route and injects `*` regardless of what the function returns.
The lockdown is only observable by calling the edge runtime directly, bypassing
Kong. **Spot-check the response headers after deploying to production.**
