# Tutorial: connecting a project dashboard

This tutorial connects a new **project dashboard** to a DataKollecta project, so the dashboard updates itself on a schedule with no manual exports. It uses PRISM CSS as the example. Expect it to take about 15 minutes.

## How the pieces fit

```
DataKollecta project ──(data feed key)──► sync job in the dashboard's database ──► dashboard website
```

- **DataKollecta** keeps the original data. The dashboard only ever gets a read-only copy.
- The dashboard has **its own Supabase database**, holding a copy of the project's records and the dashboard's own users.
- A **sync job** runs inside that database on a schedule you choose, for example every 4 hours. It asks the [feed](/docs/data-feeds/api-reference) for anything new or changed and saves it. The schedule doesn't depend on GitHub, Vercel or anyone's computer being on.
- The **dashboard website** (Next.js, usually hosted on Vercel) reads only from its own database.

The DataKollecta dashboard template, `new_project_dashboard`, contains all of this: the website, the database setup, the sync job and a setup script. Its `README.md` has the same steps in more technical detail.

## Before you start

You need:

- **Owner** access to the project in DataKollecta
- a [Supabase](https://supabase.com) account (the free plan is enough to start)
- a [Vercel](https://vercel.com) account, to put the dashboard online
- on your computer: Node.js 22 or later, the Supabase CLI (`brew install supabase/tap/supabase`) and a copy of the `new_project_dashboard` template

## Step 1: Create a data feed key

1. In DataKollecta, open the project (for example *PRISM CSS 2026*), then **Settings → Data feeds**.
2. Choose **Create key**.
   - Name: *PRISM CSS dashboard*
   - Surveys: tick the survey the dashboard shows
   - Leave **Also include test data** off
3. Copy the key, and the **Feed URL** shown above the list. Keep both somewhere safe for the next few minutes. You'll paste them into the setup script.

See [Creating and revoking keys](/docs/data-feeds/create-key) for the details.

## Step 2: Create the dashboard's Supabase project

1. In Supabase, create a new project, for example *prism-css-dashboard*. Note its **project ref**, the short ID in its URL (`https://supabase.com/dashboard/project/<ref>`).
2. Go to **Database → Extensions** and enable `pg_cron` and `pg_net`.

## Step 3: Copy the template and run the setup script

```bash
cp -r new_project_dashboard prism_css_dashboard
cd prism_css_dashboard
npm install
supabase login
./scripts/setup.sh
```

The script asks for:

| Prompt | Example |
|---|---|
| Supabase project ref | `abcdefghijklmnopqrst` |
| Feed URL | from Step 1 |
| Feed key | from Step 1 |
| Sync interval | `4 hours` (the default), `30 minutes`, `1 day`, … |

It then creates the database tables, stores the key as a Supabase secret (not in any file), deploys the sync job, schedules it, and runs it once. The first run copies everything collected so far.

## Step 4: Check the first sync

In the Supabase dashboard, open the **SQL Editor** and run:

```sql
select started_at, status, rows_upserted, rows_deleted, warnings
from sync_runs order by started_at desc limit 5;
```

You should see a run with status `success`. The data itself is in `dk_submissions`:

```sql
select table_name, count(*) from dk_submissions group by table_name;
```

The counts should match the **deployed** record counts on the project's **Data** tab in DataKollecta.

## Step 5: Add users and run the dashboard

1. Add each person who may see the dashboard:

   ```sql
   insert into allowed_users (email) values ('someone@example.org');
   ```

2. In Supabase, go to **Authentication → URL Configuration** and add your dashboard's address (and `http://localhost:3000` while testing) to **Redirect URLs**.
3. Copy `.env.example` to `.env.local` and fill in the Supabase URL and keys from **Project Settings → API**.
4. Run `npm run dev` and open `http://localhost:3000`. Sign in with an allowed email. The starter page shows the record count per form, records per day and the latest records.
5. To put it online, import the folder into Vercel and set the same variables there. The **feed key is not one of them**: it lives only in Supabase.

## Changing how often it syncs

Run this in the dashboard's SQL Editor. It takes effect at once, with nothing to redeploy:

```sql
select set_sync_interval('6 hours');
```

It accepts any number of minutes, hours or days (`'15 minutes'`, `'2 hours'`, `'1 day'`), or a standard cron expression such as `'0 6,18 * * *'` for 06:00 and 18:00 UTC.

To pause syncing, run `select set_sync_enabled(false);`. To resume it, run `select set_sync_enabled(true);`. To sync immediately, outside the schedule, run `select run_sync_now();`.

## Building the real dashboard

Every form arrives in one table, `dk_submissions`, with its answers in a `data` column. To get an ordinary table-like view of a form, run:

```sql
select generate_form_view('hh_info');
```

This creates a view called `v_hh_info`, with one column per question. Build your charts and summaries on these views.

When a later survey version adds questions, run `generate_form_view` again to add the new columns.

The PRISM CSS dashboard is a complete example of a finished dashboard. It has typed tables, summary functions and per-site access rules.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `sync_runs` shows `error` with `401` | The key was revoked or has expired, or the project is archived. Create a new key, then run `supabase secrets set DK_FEED_KEY=…` and `select run_sync_now();`. |
| A sync succeeds but copies 0 rows | The key reads deployed data only and nothing is deployed yet, or the wrong surveys were ticked. Check the key in **Settings → Data feeds**. |
| Records disappeared from the dashboard | They were [reclassified as test](/docs/data/reclassify). The feed sends a tombstone and the sync removes them. This is expected. |
| New questions are missing from a view | Run `generate_form_view` again for that form. |
| No runs appear at all | Check that `pg_cron` and `pg_net` are enabled, then run `select * from cron.job;`. You should see a job named `pull-datakollecta`. |
