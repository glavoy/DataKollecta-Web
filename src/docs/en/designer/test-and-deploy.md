# Testing and deploying

A survey goes from **Draft** to **Test** to **Deployed**. Testing on a real phone before deploying is the best way to catch routing mistakes, because a survey can't be edited once it's deployed.

## 1. Clear the Issues panel

Open the **Issues** panel (the *errors · warnings* button in the header) and fix every **error**. You can't Promote to Test or Deploy while any remain. Read the **warnings** too: each one is usually a real mistake.

## 2. Promote to Test

Choose **Promote to Test** in the designer header. The survey is saved and its status becomes **Test**.

- Phones can now download it, and it appears in the app as **`[TEST] Survey name`**.
- **You can still edit it.** After each change, choose **Save**, then download the survey again on the test phone so it has the updated copy. The field app's User Guide explains how.

## 3. Try it on a phone

Sign in to the field app with a field-team login for this project. Download the `[TEST]` survey, then:

- **Walk every route.** Give answers that should trigger each skip rule, and answers that shouldn't.
- **Try to break it.** Enter out-of-range values, impossible dates, and answers that should fail each logic check. Check that the error messages make sense to an interviewer.
- **Check repeating forms**: the prompts, the counts, and what happens if you stop early.
- **Check IDs**: are they built the way you expect?
- **Sync**, then open the project's **Data** tab and choose the **Test** filter. Check the records arrived and the exported CSV looks right.

Fix what you find, **Save**, download the updated survey on the phone, and repeat.

> Building from Excel? The **SurveyTest** desktop tool can run hundreds of simulated interviews against a package before you even reach a phone. See [Building from Excel](/docs/designer/excel-surveygen#dry-run-with-surveytest).

## 4. Deploy

When you're satisfied:

1. **Sync every test device.** Records are labelled with the survey's status at the moment they reach the server. Test interviews uploaded after you deploy would be labelled *Deployed*.
2. Choose **Deploy** and confirm.

The survey is now **locked**: its questions can never be changed again. Field workers receive it at their next sign-in. Sessions last up to 30 days, so ask your team to sign in again (or sync) if they need it straight away.

You can also deploy straight from **Draft**, but you'll be warned that the survey hasn't been tested.

## Changing a deployed survey

You can't edit a deployed survey. Go to the project's **Surveys** tab, open the survey's **⋮** menu, and choose **New Version**. The new version is a Draft copy that **shares the same database**, so its data joins the existing dataset. Test it and deploy it in the same way. See [Versions and duplicates](/docs/surveys/versions).

## Downloading the package

**Preview & Export** shows the generated form XML and the manifest. **Download Zip Package** saves the complete package. You only need it if you're delivering the survey another way, such as to a GiSTX installation, or archiving it. Phones that use this website download surveys automatically.
