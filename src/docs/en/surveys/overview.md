# Surveys and their status

The project's **Surveys** tab lists every survey in the project and every version of each one.

## The surveys list

Each row shows a survey's **name**, its **Survey ID** (underneath the name), its **version**, and its **status**.

- **Versions are grouped.** Only the latest version is shown at first. If a survey has earlier versions, the row says *"N versions, one dataset"*. Click the arrow to show them.
- **Show completed** reveals surveys whose status is Complete, which are hidden by default.
- A **"2 live"** badge means more than one version of a survey is deployed at the same time. That is allowed. For example, one team might still be on version 1 while another has moved to version 2, and their data goes to the same place either way.

![The Surveys tab, with earlier versions of one survey expanded](/docs/img/surveys/surveys-list.jpg)

The buttons on each row are:

- **Edit** (pencil) opens a Draft or Test survey in the [Survey Designer](/docs/designer/overview). For a Deployed or Complete survey the button is **View** (eye), which opens it read-only.
- **Download** saves the survey package (ZIP).
- The **⋮** menu has **New Version**, **Duplicate as new survey**, the status changes allowed from the current status, and **Delete**.

![The actions menu on a deployed survey](/docs/img/surveys/survey-menu.jpg)

To add a survey, use **Create New Survey** (opens the designer) or **Upload ZIP** (see [Uploading a survey package](/docs/surveys/upload)).

## The four statuses

| Status | On phones? | Editable? | Use it for |
|---|---|---|---|
| **Draft** | No | Yes | Building the survey. |
| **Test** | Yes, shown as `[TEST] Survey name` | Yes | Trying it out on real devices before fieldwork. |
| **Deployed** | Yes | **No, locked** | Live data collection. |
| **Complete** | No (no new downloads) | **No, locked** | Collection has finished. The data is kept. |

## Changing status

Use the row's **⋮** menu (**Move to …**), or the **Promote to Test** and **Deploy** buttons in the designer. Only these changes are allowed:

```
Draft  ⇄  Test
Draft  →  Deployed        Test  →  Deployed
Deployed  ⇄  Complete
```

There is no way back from Deployed to Test or Draft. Once a survey has been used in the field, its questions are fixed for good.

### Deploying

Deploying **locks** the survey, and its questions can never be changed again. If you need to change it later, create a [New Version](/docs/surveys/versions). The confirmation dialog warns you about two things:

- **Sync every test device first.** Each record is labelled with the survey's status at the moment it reaches the server. Test interviews uploaded *after* you deploy arrive labelled **Deployed**, and you would have to [reclassify](/docs/data/reclassify) them.
- **If an older version is already deployed**, you can tick **Also move v1 to Complete**. Phones then stop being offered the old version. Devices that already have it can keep collecting and syncing.

Phones download a newly deployed survey **at their next login**. Sessions last up to 30 days, so it may not reach every device straight away.

### Completing

Moving a survey to **Complete** stops phones from downloading it. Its data is kept, and you can move it back to **Deployed** if collection needs to start again.

## What "locked" means

You can open a locked survey (Deployed or Complete) in the designer, but nothing can be changed. A banner explains why. Its Survey ID is already installed on field devices, and changing the questions under that ID would leave records that no longer match their questionnaire.
