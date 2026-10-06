# How it works

Every DataKollecta study goes through the same steps. Each step happens either on the website or in the field app.

```
  WEBSITE                                   FIELD APP (offline)
  ───────                                   ───────────────────
  1. Create a project
  2. Add members and field-team logins
  3. Build or upload a survey  (Draft)
  4. Promote to Test  ───────────────────▶  testers download "[TEST] Survey"
                                            and try it on a real device
  5. Deploy  (survey is locked) ─────────▶  field workers download it
                                            at their next login
                                            6. Interview, offline
                                            7. Sync when online
  8. View, check and export data  ◀────────  records + edit history
```

## 1. Set up a project

A **project** contains one study. The person who creates it becomes its **owner**. The owner then adds:

- **Members**: colleagues who use the website, each as an owner, editor or viewer.
- **Field-team credentials**: a username and password for each data collector or device, used in the field app.

## 2. Build a survey

A **survey** is your questionnaire. It is made of one or more **forms**. For example, a *Household* form, plus a *Household member* form that repeats for each person in the household. There are two ways to build one:

- In the website's **[Survey Designer](/docs/designer/overview)**.
- In an Excel data dictionary, turned into a package with the **[SurveyGen](/docs/designer/excel-surveygen)** tool and uploaded to the website.

Either way, the result is a **survey package**: a ZIP file holding the form definitions and any lookup files. The field app installs this package.

## 3. Test, then deploy

A new survey starts as a **Draft**, which no phone can see. When you **Promote to Test**, the survey can be downloaded and appears on phones as `[TEST] Survey name`. You can still edit it while it is in Test. When it is ready, you **Deploy** it. Deploying **locks** the survey: its questions can never change again. That rule keeps every record traceable to the exact questionnaire that produced it. To make changes after deploying, you create a **[New Version](/docs/surveys/versions)**.

## 4. Collect offline

Field workers sign in to the app with the **project code**, their **username** and their **password**. The app downloads the project's test and deployed surveys. From then on, interviews need no connection at all. Records are saved on the device, and so is a full history of every later edit.

> **Phones pick up new surveys at their next login.** App sessions last up to 30 days. A survey you deploy today may therefore not reach a device that is already signed in until that device signs in again.

## 5. Sync

When a device is online, the field worker syncs. The app uploads new and changed records, along with their edit history. Uploads are safe to retry: if a sync is interrupted, sending the same records again never creates duplicates.

## 6. Review and export

Uploaded records appear on the project's **[Data](/docs/data/browse)** tab within moments. You can open any record to see its values and its full edit history. You can export one form, or a whole survey across all its versions, to CSV. Each record is also labelled **test** or **deployed** data, so records from practice interviews don't end up in your analysis.
