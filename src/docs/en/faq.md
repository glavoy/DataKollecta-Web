# FAQ and troubleshooting

## Surveys

### My survey doesn't appear on the phone

Check these in order:

1. **Status.** Phones only see surveys in **Test** or **Deployed**. Draft and Complete surveys are not offered.
2. **The phone's session.** New surveys are offered when the device signs in, and sessions last up to 30 days. Ask the field worker to sign in to the project again from the app's Settings.
3. **The right project.** The phone must be signed in with *this* project's code.
4. **Project access.** A **Paused** or **Archived** project blocks all field access. See [Project settings](/docs/projects/settings#access-and-visibility).

### I can't edit my survey

It's **Deployed** or **Complete**, so it's locked. Create a [New Version](/docs/surveys/versions) from the Surveys tab. The new version keeps the same database, so its data joins the existing dataset.

### "Promote to Test" or "Deploy" says there are errors

Open the **Issues** panel from the designer header, fix every error, and try again. See [The Survey Designer → Issues panel](/docs/designer/overview#the-issues-panel).

### My upload was rejected

| Message | Fix |
|---|---|
| *survey_manifest.gistx is missing* | The ZIP isn't a survey package. Upload the ZIP that SurveyGen or the designer produced, not a folder you zipped yourself. |
| *'crfs' array is missing or empty* / *'surveyId' is required* | The manifest is incomplete. Rebuild the package. |
| Survey ID already exists | Give the revision a new `surveyId` and rebuild. |
| *Add as version N of …?* | This isn't an error. The package shares a Database Name with an existing survey. See [Uploading](/docs/surveys/upload#how-the-upload-is-matched-to-existing-surveys). |

### I can't delete a survey

Only **Draft** or **Test** versions with **no uploaded records** can be deleted. Collected data, including test data, is never destroyed. See [Deleting a survey](/docs/surveys/delete).

### Should I use New Version or Duplicate?

Use **New Version** to *revise* the same study, so the data stays together. Use **Duplicate as new survey** to *start a different* study. See [Versions and duplicates](/docs/surveys/versions).

## Field team

### A field worker can't sign in

- Check the **project code**: it's shown on the project page and is always lowercase. Phone keyboards often capitalise the first letter.
- On the **Field Team** tab, check the credential is **Active**, and that the username is spelled exactly.
- **Reset the password** if in doubt. Remember that this signs out every device using that credential.
- Check that the project isn't **Paused** or **Archived**.

### A phone has records but can't upload them

Usually the session has expired, or the password was reset: sign in again in the app's Settings. If the project's data is **locked**, uploads wait on the device until an owner reopens it. Records are never lost on the device because of a refused upload.

## Data

### My records aren't showing

- Check the **Deployed / Test / All** filter. Records from a survey in Test are labelled **test** and hidden by default.
- Make sure the device has actually synced.
- Make sure you're looking at the right form. Child-form records are under their own form, not the parent's.

### Practice interviews are showing as deployed data

A test device synced after the survey was deployed. An owner can [reclassify](/docs/data/reclassify) them.

### Subject IDs are duplicated or restarted on a device

This happens when a survey's **Database Name** changes between versions, or when an app is reinstalled and its data cleared. The website prevents the first cause for surveys managed here. Contact support if you see it.

## Account

### I can't change my password

For security, a password change must be made within 24 hours of signing in. Sign out, sign in again, and retry.

### A colleague can't find my project

They need to be added as a [member](/docs/people/members), and they need an account first. There is no invitation email: the project simply appears in their Projects list.
