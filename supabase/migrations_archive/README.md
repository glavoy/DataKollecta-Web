# Archived migrations

These four files were written to document SQL that had already been run by hand
through the Supabase SQL editor, against a schema that itself was built by hand
(`schema.sql` was 0 bytes -- there was never a CLI-tracked baseline). Because they
are patches ("add this index", "alter this policy") rather than full definitions,
replaying them against an empty database -- which `supabase db pull`/`db push` must
do to compute a diff -- fails immediately: the very first one references a table
that only exists because it was created outside of migration history.

`20260817102141_remote_schema.sql` (in `supabase/migrations/`) was pulled directly
from the live database once these files were moved out of the way, and is a full
baseline that already includes everything these four files changed. They are kept
here, out of `supabase/migrations/`, purely so the reasoning behind each change
(most of which is written as comments in the files themselves) isn't lost -- not
because they still need to run. Do not move them back into `supabase/migrations/`;
the CLI will fail the same way it did before.
