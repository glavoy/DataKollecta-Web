# Changelog — DataKollecta Web

> **Versioning.** One version, `X.Y.Z` in `package.json`, covers everything this repository
> ships together: the portal, the database migrations and the Edge Functions (`app-login`,
> `app-sync`, `project-data-feed`). Between releases, changes accumulate under `## [Unreleased]`; at release that
> heading becomes `## [X.Y.Z] - <date>`, `package.json` is bumped, and the commit is tagged
> `web-vX.Y.Z` (DK-SOP-001 §4.4). Commits between releases keep the previous version; the portal
> shows the commit next to the version, so every build is still identifiable.
>
> - **Z (patch)** — fixes and wording; nothing a user has to learn and no new data recorded.
> - **Y (minor)** — new features, new columns or exports, new migrations that add to the schema.
> - **X (major)** — anything that breaks the mobile app's sync contract, changes the meaning of
>   recorded data, or needs action from every project.
>
> Each release records its **migration head** (the last file in `supabase/migrations/`), so the
> database schema of a release is never in doubt.

## [Unreleased]

### Housekeeping
- References to the deleted validation repository's documents now point to the new validation
  package (DK-SOP-001, DK-VAL-002, DK-VAL-003, URS-603). Comment-only change in migration
  `20261005100000`; nothing re-runs. README gains a Validation section.

## [1.2.0] - 2026-10-08

**Migration head:** `20261008150000_purge_test_submissions.sql`

### Added
- **Owners can purge test records** (Data tab → Test → *Purge test records…*), with a required
  reason. Only records labelled test can be removed; deployed data still can never be deleted, by
  any route, and a data lock refuses a purge. Each purged record's full content stays in the audit
  trail. A phone that re-syncs a purged record is ignored (`DISCARD_PURGED` audit event), so it
  cannot come back labelled deployed. Data feeds send a tombstone for each purged record. Records
  that arrived as deployed and were reclassified can be purged, but the dialog shows them
  separately and the `PURGE` event flags them. New column `submissions.received_status` and new
  table `purged_submissions`. Validation requirement URS-603.

## [1.1.1] - 2026-10-08

**Migration head:** `20261008120000_scope_survey_storage_to_projects.sql`

### Security
- **Survey package storage is now scoped to project membership.** Any signed-in portal user,
  including one in no project, could list, download, overwrite or delete any project's survey
  packages in the `surveys` storage bucket: its policies only checked that the caller was signed
  in. Now project members can read their own project's packages, and only its owners and editors
  can upload, replace or delete them. The zip of a **deployed or complete** survey cannot be
  overwritten or deleted by anyone through the API, closing the path by which a deployed
  package's zip was destroyed on 2026-08-23. After an empty project is deleted, its former
  owners and editors can still remove its leftover zips. The unused `uploads` bucket's
  open policies are removed. Migration `20261008120000_scope_survey_storage_to_projects.sql`;
  tests in `supabase/functions/tests/storage-policies.test.ts`.

## [1.1.0] - 2026-10-08

**Migration head:** `20261008090000_project_feed_keys.sql`

### Added
- **Data feeds.** Project owners can create read-only **data feed keys** (Settings → Data feeds) so a
  dashboard or scheduled script can read one project's data automatically. A key is scoped to one
  project, optionally to some surveys, and to deployed data unless the owner includes test data; it
  can expire and be revoked, and only its SHA-256 is stored. The new `project-data-feed` Edge
  Function serves `forms`, `submissions` (incremental, keyset-paged, with tombstones for records
  reclassified out of scope) and `formchanges`; the project always comes from the key, never from
  the request. Key creation, revocation and feed reads are written to the audit trail. Migration
  `20261008090000_project_feed_keys.sql`, which also makes the database bump
  `submissions.updated_at` on every update (previously `reclassify_submissions` did not). New docs
  section *Data feeds (API access)*, including a tutorial for connecting a project dashboard.
- **Documentation at `/docs`.** Public, no sign-in. Covers the platform, projects, members, field
  teams, roles, surveys and versions, the Survey Designer (reference pages and a household-survey
  tutorial), the field app and sync, data and exports, an FAQ and a glossary. Linked from the
  landing page, the sign-in page and the sidebar, and from a Help icon on each project tab and in
  the designer. A test fails on any page missing from the nav or any broken docs link.
- **Field app download.** The landing page and the Field Team tab link to the app's permanent
  download URL (the `datakollecta.apk` asset on the latest GitHub release of the app repo), and a
  new docs page, *Installing the field app*, covers installing and updating it.

### Fixed
- The survey delete dialog said a version's collected data would be deleted with it. It never is:
  a version with any uploaded records cannot be deleted. The dialog now says so, and a refused
  delete shows the reason instead of a generic error.
- The upload dialog said the ZIP's filename becomes the Survey ID. It is the manifest's
  `surveyId`.
- The logic-check hint in the designer now says the expression describes the wrong answer: the
  app shows the message while the expression is true. The old example (`age >= 18 AND age <= 65`)
  would have blocked every valid answer.

## [1.0.0] - 2026-10-06

The original release: the first version of the portal to be numbered. Everything before it was
unversioned and is described here as the baseline, not change by change. For the history, see
`git log` before tag `web-v1.0.0`.

**Migration head:** `20261006090000_submission_data_status.sql`

### Baseline
- **Projects and access.** Projects with owner / editor / viewer members and row-level security
  on every table; project lifecycle (active, paused, archived).
- **Surveys.** Upload of SurveyGen packages and the in-portal designer, which writes the same
  package format. Survey lifecycle draft → test → deployed → complete, with deployed and
  complete surveys locked against edits and deletion. New Version keeps one dataset and one
  `databaseName` across versions; Duplicate forks a new study.
- **Field team.** Field credentials (bcrypt), password reset that signs out every phone using the
  credential, login rate limiting.
- **Mobile API.** `app-login` (credentials → session token and downloadable surveys) and
  `app-sync` (bulk upsert of submissions and device edit history).
- **Data.** Browse records per form across every version of a survey; record view with device
  and server history; CSV and ZIP export, each with a SHA-256 manifest and an `EXPORT` audit
  event.
- **Data integrity.** Append-only server audit trail on submissions, members, credentials,
  projects, surveys and forms; collected data and audit history cannot be deleted or truncated;
  owner-controlled project data lock.

### Added
- **Test and deployed data.** Every submission is labelled `test` or `deployed` from its survey's
  status when the server first received it (`submissions.data_status`, set by a trigger; a resync
  never changes it). The Data tab has a Deployed / Test / All selector, defaulting to Deployed,
  and every list, count and export follows it; each CSV carries a `data_status` column. Owners can
  correct labels with a reason through `reclassify_submissions`, audited per record. Existing
  data was labelled by the migration: project `prismcss2026` as test, all others as deployed.
  The deploy dialog now warns to sync test devices before moving a survey from test to deployed.
- **Version display.** The sidebar shows the portal version and build commit
  (`v1.0.0 · a1b2c3d`); hover for the full commit.
- **Version in exports.** Each export manifest records `portal_version` and `portal_commit`, so
  an exported file can be traced to the code that produced it. The manifest is also stored in
  the `EXPORT` audit event.
