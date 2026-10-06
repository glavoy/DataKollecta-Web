# Uploading a survey package

If a survey was built outside the website, for example from an Excel data dictionary with [SurveyGen](/docs/designer/excel-surveygen), you can upload its package as a ZIP file.

## Upload a ZIP

1. On the **Surveys** tab, choose **Upload ZIP**.
2. Choose the `.zip` file.
3. Optionally add a **Description**, for example *Initial draft for field test*.
4. Choose **Upload**.

![The Upload Survey Package dialog](/docs/img/surveys/upload-dialog.jpg)

The survey is added as a **Draft**. Promote it to Test or Deploy it from the surveys list as usual.

## What the ZIP must contain

- A `survey_manifest.gistx` file. It must have a `surveyId` and a non-empty list of forms (`crfs`).
- One `.xml` file for each form listed in the manifest.
- Any `.csv` files the survey's dropdowns use.

SurveyGen and the website's own **Preview & Export → Download Zip Package** both produce exactly this layout.

## How the upload is matched to existing surveys

- **Survey ID**: taken from the manifest's `surveyId`. It must be unique, so an upload is rejected if a survey with that ID already exists. To upload a revision, give it a new `surveyId` (SurveyGen's convention is a date, for example `household_2026_10_06`).
- **Database Name**: if the manifest's `databaseName` matches an existing survey in this project, the upload is **added as that survey's next version**. You'll be asked to confirm, for example *"Add as version 3 of Household Survey?"*.
  - Choose **Add as version 3** if this is a revision. The data will join the existing dataset.
  - Choose **Cancel upload** if you meant to create a *separate* survey. Nothing is uploaded. Give the package a different `databaseName` (in SurveyGen's `config.json`), rebuild it, and upload again.

Two different surveys can't share a Database Name. On a phone they would write into the same file, mixing their records and their ID counters.

## Editing an uploaded survey

An uploaded survey opens in the Survey Designer like any other. You can edit it while it's a Draft or in Test, and export it again. The automatic fields that SurveyGen adds are recognised and not duplicated.

If you edit an uploaded survey in the designer, remember that your Excel dictionary no longer matches it. Decide which one is the master copy and stick to it.
