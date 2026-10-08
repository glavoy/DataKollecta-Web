# What data feeds are

A **data feed** lets a program read a project's data automatically, without anyone exporting CSVs by hand. Use one when:

- a **project dashboard** should stay up to date on its own
- a **scheduled script** (an R or Python job, for example) should pick up new records every night
- a partner system needs the data on a regular schedule

For a one-off copy of the data, [Exporting data](/docs/data/export) is simpler.

## How it works

1. A project owner creates a **data feed key** on the project's **Settings** tab. See [Creating and revoking keys](/docs/data-feeds/create-key).
2. The program sends that key with each request to the **feed URL**.
3. The feed returns the project's records as JSON, one form at a time, in the same shape as the CSV export. A program can ask for **only what changed** since its last request, so it can check every few minutes or every few hours cheaply.

See the [Feed API reference](/docs/data-feeds/api-reference) for the details, and [Tutorial: connecting a project dashboard](/docs/data-feeds/dashboard-setup) for a complete walkthrough.

## What a key can read

A key belongs to **one project** and is **read-only**.

| Setting | Default | Meaning |
|---|---|---|
| Project | The project it was created in | Fixed. It can't be changed. |
| Surveys | All surveys in the project | Can be narrowed to some surveys when the key is created. |
| Data | Deployed records only | Test records can be included as well, if you choose. See [Test and deployed records](/docs/data/reclassify). |
| Expiry | Never | An optional date after which the key stops working. |

A key **can't**:

- read any other project. The project comes from the key itself, so there's no setting or parameter a program could change to reach another project.
- change, add or delete anything
- sign in to this website
- download survey packages or see members, field-team credentials or settings

## Who can manage keys

| Action | Owner | Editor | Viewer |
|---|:---:|:---:|:---:|
| See the project's keys | ✓ | | |
| Create a key | ✓ | | |
| Revoke a key | ✓ | | |

## The audit trail

Creating a key, revoking a key and every program run that reads data through a key are recorded in the project's audit trail, in the same way as a CSV export. Reads are recorded once per run, not once per page, and name the key (for example `feed key 3fa9c2d1 (Project dashboard)`).

> **Treat a key like a password.** Anyone who has it can read the project's data. See [Storing a key safely](/docs/data-feeds/create-key#storing-a-key-safely).
