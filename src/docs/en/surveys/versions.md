# Versions and duplicates

There are two ways to copy a survey, and they do very different things. Choosing the wrong one is the most common survey-management mistake.

| | **New Version** | **Duplicate as new survey** |
|---|---|---|
| Use it to | Revise a survey: fix a typo, add a question, change a range | Start a *different* study based on an existing one |
| Database Name | **Same** as the original | **New** |
| Data | Joins the original's dataset and is exported together | Completely separate |
| Subject IDs on each phone | Carry on from where the last version stopped | Start again |
| Survey ID | Assigned for you: `<survey>_v2`, `_v3`, … | You choose it |
| Display name | `<name> v2`, `<name> v3`, … | You choose it |

## Create a new version

1. On the **Surveys** tab, open the **⋮** menu on any version of the survey.
2. Choose **New Version**.

A new **Draft** is created as a copy of the latest version, and it opens in the designer. Make your changes, test them, and deploy as usual.

In a new version, the **Survey ID** and **Database Name** are read-only. That is deliberate: sharing the Database Name is what keeps all versions in one dataset.

> **Locked survey open in the designer?** The designer's **Duplicate to revise** button makes a *separate* copy with its own Survey ID. To revise a deployed survey and keep its data together, go back to the **Surveys** tab and use **New Version** instead.

### Running two versions at once

You can deploy version 2 while version 1 is still deployed. Teams that haven't signed in again keep using version 1, and their data still lands in the same dataset. When you deploy version 2, you can tick **Also move v1 to Complete** to stop new phones from receiving version 1.

### How versions appear in exports

Exporting a survey from the **Data** tab includes the records from **every version** in one set of files. Every row has a `survey_version` column, so you can always tell which questionnaire produced it. A blank cell could mean "not asked in that version" or "skipped", and that column tells you which. See [Exporting data](/docs/data/export).

## Duplicate as a new survey

1. Open the **⋮** menu on the survey and choose **Duplicate as new survey**. If the survey is locked and open in the designer, you can use **Duplicate to revise** there instead.
2. Enter a new **Survey ID**, a **Display name**, and a **Database name**. A new database name is suggested for you.
3. Choose **Duplicate**.

You get an independent **Draft** containing all the forms, questions and CSV files. The original isn't affected. The surveys list shows *"Copied from …"* on the copy.

> Only reuse the original's database name if you really mean to continue the same survey's ID counters. Two *different* questionnaires writing to one database file on a phone will corrupt data.

## Why Database Name must never change between versions

On a phone, the Database Name is the file the records live in. Subject-ID counters are worked out from the records already in that file. If a revision used a new Database Name:

- each phone would open a new, empty file
- ID counters would restart, creating **duplicate subject IDs**
- records still in the old file would stop syncing

The website prevents this: every version of a survey keeps the same Database Name, and two different surveys can't share one.
