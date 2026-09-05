-- Creates the `surveys` storage bucket, which nothing has ever created.
--
-- 20260817102141_remote_schema.sql defines six RLS policies on storage.objects
-- against `bucket_id = 'surveys'`, and every survey path in the app reads or
-- writes through that bucket: the package upload (ProjectDetail.tsx and
-- surveyService.saveSurveyPackage), the zip download that CSV content is
-- extracted from (loadCsvFilesFromZip), the project-delete cascade
-- (ProjectSettings.tsx), and the 24-hour signed URL the Flutter app downloads
-- a survey through (supabase/functions/app-login).
--
-- But the bucket itself was created by hand in the Supabase dashboard, so it
-- exists only in production. A fresh `supabase start && supabase db reset`
-- gave a stack where all of the above failed with `Bucket not found`
-- (400/404) -- policies granting access to a bucket that isn't there. That is
-- not a subtle failure, but it is an undiscoverable one: nothing in the repo
-- said the bucket had to be made, so local QA of the upload path was
-- impossible without already knowing.
--
-- public = false, matching production and matching the code: nothing calls
-- getPublicUrl, and both read paths mint short-lived signed URLs
-- (createSignedUrl, 3600s from the web app and 86400s from app-login). A
-- public bucket would also make the six `auth.role() = 'authenticated'`
-- policies pointless.
--
-- `on conflict do nothing` is what makes this safe to push. Production's row
-- already exists and keeps whatever file_size_limit and allowed_mime_types the
-- dashboard set on it -- this migration cannot know those, so it must not
-- overwrite them. Deliberately not `on conflict do update`.
--
-- Not done in config.toml's [storage.buckets] instead: that section is one of
-- the ones `supabase config push` sends to production, with Yes preselected on
-- the prompt. A migration is reviewed per-statement and is idempotent here by
-- construction.

insert into storage.buckets (id, name, public)
values ('surveys', 'surveys', false)
on conflict (id) do nothing;
