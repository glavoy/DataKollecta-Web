# DataKollecta Web

DataKollecta is a comprehensive platform designed for research projects, field surveys, and clinical trials. It enables organizations to design complex surveys, manage field teams, and ensure data integrity across both offline and online environments.

See [DESIGN.md](DESIGN.md) for the full picture — system architecture, user roles, the data model, and the mobile-app API contract.

## Key Features

### 🚀 Survey Design Engine
*   **Visual Builder:** intuitive interface for creating and managing survey forms.
*   **Complex Logic:** Support for skip logic, validation rules, and specialized question types (text, date, single/multi-select, etc.).
*   **Form Management:** Version control, form duplication, and lifecycle management.

### 📊 Data Management & Project Overview
*   **Project Stats:** At-a-glance cards for survey, form, and record counts per project.
*   **Flexible Storage:** JSONB-based storage to accommodate varying survey structures without schema migrations.
*   **Export & Analysis:** Export submissions to CSV or a ZIP of CSVs for external analysis.
*   **Edit History:** Every field-level correction made after a record first syncs is tracked and viewable per record.
*   **Row-Level Security:** Strict data isolation ensures users only access data they are authorized to see.

### 👥 Team & Field Management
*   **Worker Credentials:** Manage dedicated credentials for field workers.
*   **Session Tracking:** Monitor active sessions and data collection activity.
*   **Offline-First:** Built-in support for offline data collection with robust synchronization and conflict resolution when connectivity is restored.





## Project Structure

*   `src/components`: Reusable UI components and feature-specific widgets.
    *   `src/components/survey-designer`: Core logic for the survey builder.
    *   `src/components/project`: Project detail sub-views (overview, data, settings).
    *   `src/components/projects`: The projects list.
    *   `src/components/teams`: Field-team credential management.
    *   `src/components/layout`: App shell (sidebar, navigation).
    *   `src/components/ui`: Shadcn UI primitives.
*   `src/pages`: Top-level route components (Projects, ProjectDetail, Login, SurveyDesignerPage, etc.).
*   `src/lib`: Utility functions, Supabase client setup, and XML generation logic.
*   `src/services`: Supabase-backed data access (projects, submissions, project members).
*   `src/types`: TypeScript definitions for surveys, forms, and data structures.
*   `src/hooks`: Custom React hooks (e.g., authentication, mobile detection).

*   `supabase/functions`: The two Edge Functions the mobile app talks to
    (`app-login`, `app-sync`), and their test suite.
*   `supabase/migrations`: Database schema, RLS policies and RPCs, applied in order.
*   `supabase/config.toml`: Auth policy and service settings, for **both** the
    local stack and production. See below.

## Where auth policy lives

`supabase/config.toml` -- not the Supabase dashboard. Password length, email
confirmation, re-authentication on password change, OTP length, rate limits and
MFA are all set there, reviewed in a diff like any other change, and applied
with `supabase config push`.

Two settings cannot be shared, because they are genuinely per-environment:
`site_url` and `additional_redirect_urls`. The base `[auth]` block holds the
**local** values for those two; `[remotes.production]` at the bottom of the file
overrides them with the production ones. Everything else in the file is
production's value, so a push should be a no-op.

`config push` sends seven services, not just auth: api, db, db.ssl_enforcement,
db.network_restrictions, auth, storage, and experimental.webhooks. There is no
`--dry-run` flag and no `config pull`, but **the confirmation prompt is the dry
run** -- push prints a per-service diff *before* asking, and sends nothing until
you answer:

```bash
supabase config push        # read each diff; answer No to leave production alone
```

Two things to know before you run it:

*   The prompt renders as `● Yes / ○ No` with **Yes preselected**. Pressing
    Enter pushes. You have to arrow to No. On 2026-09-04 a run intended as a dry
    run was Entered through, which turned email verification off in production
    for ten minutes.
*   It must print `Loading config override: [remotes.production]`. If that line
    is absent the override did not apply and the diff you are looking at will
    put localhost URLs into production.

A clean state is every service reporting "is up to date."

## Verification

```bash
npm run lint            # eslint
npx tsc --noEmit -p tsconfig.app.json   # neither lint nor build typechecks; this does
npm run build           # vite
npm test                # vitest -- pure functions in src/lib
```

`npm run build` uses Vite with the SWC plugin, which **strips types without
checking them**, so a type error fails neither lint nor build. Run `tsc
--noEmit` as well.

The Edge Functions have their own suite, which needs a running local stack:

```bash
supabase start && supabase db reset
supabase functions serve --no-verify-jwt    # in a second terminal
npm run test:functions
```

See [supabase/functions/tests/README.md](supabase/functions/tests/README.md) for
what it covers and why it is written against a real database rather than mocks.
