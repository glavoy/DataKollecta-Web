# To Do

- add error checking before creating/saving the xml file/survey.zip - complete error checking
- when deleting a survey, there is a confirmation box, but add another level of security - maybe typing in the surveyID to confirm
- add a cancel button to the 'Upload Survey Package' dialog box

- when upload a zip file for a survey - questions that use csv as the data source are not showing all the options properly in the 'designer'
- Need a way to add csv files to a survey 
- Need an admin account x2, no, add 'super' account that had access to all projects 
- for skips, print the entire skip at the bottom of the card
- add section to do questionnaire online in the website? can use flutter app
- for 'responses' - 'static options' and 'dynamic (csv/db) - we can only have one or the other - is there a better way to present it?
- needs to be a better way to enter: Don't Know, Refuse to Answer and Not Applicable - remove N/A completely
- remove button type

- Force all users to use MFA
- ensure the invited_by column in the project_members table gets populated when adding someone to a project
- upload a zip file works, but need to test creating a survey from scratch to see if it saves properly
- there is no way to change the password of a field user - need to delete and recreate
- add a 'whitelist' of email addresses that can login/create a user account on the website
- on the login page, add option of viewing the password
- when createing a form, don't allow 'keywords' - formerly automatic variables - starttime, etc.
- When you click 'Revoke Access' for a user, it removes them immediately - need to have a confirmation dialog box
- When modifying a survey - have temp/draft and then 'release' - keep track of who downlaoded it?
- When a survey is inactive - users cannot download it
- when there are many surveys and a user is viewing the data, the data shows below all of the surveys - there needs to be an improvemnet on how the data is displayed

## Found during the M5 decomposition - each its own commit

- **No migration creates the `surveys` storage bucket.** `20260817102141_remote_schema.sql`
  defines six RLS policies against `bucket_id = 'surveys'`, but nothing creates the bucket -
  production's was made through the Supabase dashboard. So a fresh `supabase start` +
  `supabase db reset` gives a stack where every save and upload fails with `Bucket not found`
  (400/404), which makes the upload path impossible to QA locally without knowing to run:
  `insert into storage.buckets (id, name, public) values ('surveys','surveys',false) on conflict (id) do nothing;`
  Adding that to a migration would fix local setup for good; check first that it is a no-op
  against production, where the bucket already exists.
- **`getDefaultFieldType` is declared twice, with different signatures.** One in
  `src/lib/surveyFactories.ts` (extracted from SurveyDesigner, now tested), one in
  `QuestionEditor.tsx:92`. They may already disagree about what a question type's default
  fieldtype should be. Whether they should be one function is a behaviour question, so it needs
  its own commit and a test that says which answer is right.

