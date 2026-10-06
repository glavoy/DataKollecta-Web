# Key concepts

A few ideas come up throughout DataKollecta. Understanding them first will save you from the most common mistakes.

## Project

A project is the container for one study. Everything else belongs to a project: surveys, data, members, field-team logins and settings. Each project has a **project code**, and field workers type that code into the app to reach the project.

## Members vs field team

DataKollecta has two separate kinds of login, and they don't overlap:

| | Members | Field team |
|---|---|---|
| Who | Study managers, data managers, analysts | Data collectors |
| Where they sign in | This **website** | The **field app** |
| How they sign in | Their own email and password | Project code + username + password |
| Set up on | [Members tab](/docs/people/members) | [Field Team tab](/docs/people/field-team) |
| Access | Depends on role (owner / editor / viewer) | Downloads the project's surveys and uploads data |

## Survey, version and form

- A **survey** is a questionnaire, such as *Household Survey 2026*.
- A survey can have several **versions**. Version 2 might fix a typo or add a question. All versions of a survey share **one dataset**, so their records are exported together.
- Each version contains one or more **forms**. A form is one screen-by-screen questionnaire that saves to one table, such as *Household* or *Household member*. Forms can be linked as parent and child, so a child form can repeat for every member of a household.

## Survey ID and Database Name

Every survey has two technical names, and they behave very differently:

- **Survey ID**: a unique name for one version, for example `household_2026_v2`. It becomes the package file name. Each new version gets a new Survey ID automatically.
- **Database Name**: the file the field app stores records in, for example `household_2026.sqlite`. It **stays the same for every version of a survey**. That keeps the data together and keeps subject-ID numbering continuous on each device.

> **Never change a survey's Database Name between versions.** A new Database Name gives every phone a new, empty database. Subject-ID counters would start again from 1, which creates duplicate IDs, and records left in the old database would stop syncing. The website stops you doing this by mistake.

## Survey status

Each survey version is in one of four states: **Draft**, **Test**, **Deployed** or **Complete**. The state controls whether phones can download the survey and whether you can still edit it. See [Surveys and their status](/docs/surveys/overview).

## Records and edit history

A **record** is one completed form, such as one household or one household member. Field workers can correct a saved record later on the phone. Each change is kept as **edit history**, showing who changed what and when, and that history is uploaded with the record.

## Test data vs deployed data

Each record is labelled **test** or **deployed**, depending on the survey's status when the record first reached the server. The **Data** tab and exports show deployed data by default, so practice interviews stay out of your analysis. See [Test and deployed records](/docs/data/reclassify).

## Subject IDs

A form can generate its own IDs. An ID is built from a fixed prefix, the values of some fields (for example a village code), and a number that goes up by one each time. The field app works these out on the device, from the records already in that device's database. This is why the Database Name has to stay stable. See [Forms → ID generation](/docs/designer/forms#automatic-id-generation).
