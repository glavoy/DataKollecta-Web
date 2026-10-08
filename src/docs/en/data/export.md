# Exporting data

You can export data from the project's **Data** tab. Every role can export, and every export is recorded in the project's audit trail.

The **Deployed / Test / All** filter at the top decides which records are included. By default, only deployed data is exported.

## Export one form

1. Click a form to open its records.
2. Choose **Export This Form**.

You get two files:

- `<table>_<date>.csv`: the form's records. For a Test or All export, the name includes `_test` or `_all`.
- `<table>_<date>.csv.manifest.json`: an integrity record of the export (see below).

## Export a whole survey

On the survey's card, choose **Export Deployed** (or **Export Test** / **Export All**, depending on the filter). You get one ZIP, `<survey>_data_<date>.zip`, containing:

| File | Contents |
|---|---|
| `<table>.csv` | One file per form, with records from **every version** of the survey |
| `formchanges.csv` | The device edit history for the exported records |
| `project_audit.csv` | The project's server audit trail |
| `manifest.json` | The integrity record |

## What's in each CSV

Each row is one record. The first columns are the same in every file:

| Column | Meaning |
|---|---|
| `survey_version` | Which version of the questionnaire produced the row |
| `data_status` | `test` or `deployed`. It is included on every row, so a CSV that gets passed around still says whether it holds test data. |
| `local_unique_id` | The record's unique ID. It matches `uniqueid` on the device and the record ID in `formchanges.csv`. |
| `surveyor_id` | The field-team username that uploaded it |
| `collected_at` | When the interview took place, by the device's clock |
| `submitted_at` | When the server received it |

These are followed by one column per question, in questionnaire order, including the [automatic fields](/docs/designer/automatic-fields).

- **Blank cells** mean the question was skipped, or it didn't exist in that row's `survey_version`.
- **Coded answers** are exported as their codes (for example `1`, `2`, `-7`), not their labels. Use your questionnaire, or the designer's **Preview & Export**, as the codebook.

## The manifest

Every export comes with a manifest file recording:

- when the export was made, and the portal version that produced it
- the scope, for example *survey household_2026; deployed data only*
- a **SHA-256 hash and size for every file**

The hashes let anyone check later that a file hasn't been changed since it was exported. The project's audit trail records the same details, plus who made the export.

> An export reads the data as it is at that moment. For a dataset that will be formally endorsed, [lock the project's data](/docs/projects/settings#data-lock) first, so that nothing can change between the review and the export.

> To keep a dashboard or script up to date automatically instead of exporting by hand, use a [data feed](/docs/data-feeds/overview).
