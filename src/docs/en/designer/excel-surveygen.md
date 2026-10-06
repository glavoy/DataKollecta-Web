# Building from Excel (SurveyGen)

You can also design a survey in an **Excel data dictionary** instead of the Survey Designer. Many teams already keep their questionnaire this way, and it is convenient for very large surveys, for reviewing changes line by line, and for keeping several language versions side by side.

The data dictionary is turned into a survey package by **SurveyGen**, a free command-line tool:

**→ [DataKollecta-SurveyGen on GitHub](https://github.com/glavoy/DataKollecta-SurveyGen)**

Its README is the complete reference for the Excel format. It covers every column, response formats, skip and logic syntax, calculations, and the `crfs` sheet that defines forms, IDs and repeats.

## How it works in outline

1. **Write the data dictionary.** Each form is a worksheet whose name ends in `_dd`. Each question is one row, with columns such as `FieldName`, `QuestionType`, `QuestionText`, `Responses`, `LogicCheck` and `Skip`. A worksheet named `crfs` lists the forms and how they link together.
2. **Set `config.json`**: the Excel file, the output folder, `surveyName`, `surveyId` and `databaseName`.
3. **Run SurveyGen.** It checks the dictionary and either writes a complete `<surveyId>.zip` or reports what to fix. It never writes a partial package.
4. **Upload the ZIP** on the project's **Surveys** tab. See [Uploading a survey package](/docs/surveys/upload).

## Revisions

- Give every revision a **new `surveyId`**. SurveyGen's convention is a date, for example `household_2026_10_06`.
- **Never change `databaseName`.** When you upload the revision, the website sees the matching Database Name and offers to add it as the next version of the existing survey, so the data stays together.

## Dry run with SurveyTest

**SurveyTest** is a companion desktop app for Windows, macOS and Linux. It runs a package through the field app's own survey engine before fieldwork:

- It plays hundreds of simulated interviews.
- It tries to make each skip rule both fire and not fire.
- It writes a report of design problems, such as questions that can never be reached, or answers that leave the interviewer stuck.

It is a useful step between building a package and testing it on phones. → [DataKollecta-SurveyTest on GitHub](https://github.com/glavoy/DataKollecta-SurveyTest)

## Designer or Excel?

| | Survey Designer | Excel + SurveyGen |
|---|---|---|
| Setup | None, it's in the browser | Python and SurveyGen installed |
| Best for | Small to medium surveys, quick changes, people new to DataKollecta | Large surveys, teams that already work in Excel, translated versions |
| Checks | Live Issues panel | Validation report at build time, plus SurveyTest |

You can mix the two: an uploaded package can be opened and edited in the designer. Keep **one master copy** of the questionnaire, though. Edits made in the designer aren't copied back to your Excel file.
