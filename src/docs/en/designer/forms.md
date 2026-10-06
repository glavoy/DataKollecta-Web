# Forms

A survey is made of one or more **forms**. Each form is a sequence of questions that saves to its own table. Each record in that table is, for example, one household, one person, or one visit.

Add a form with the **+** button beside the form tabs. Open a form's configuration with the **Settings** button on its card.

The form settings are grouped into five sections:

1. **Basic Identification**: Display Name, Table Name, Display Fields
2. **Hierarchy & Navigation**: Parent Table, Linking Field, Entry Condition
3. **ID Generation**: Primary Key, automatic IDs, Increment Field
4. **End of Survey Screen**: the closing message
5. **Auto-Repeat Logic**: Repeat Count Field, Auto-Start Behavior, Enforce Count

## Three kinds of form

| Kind | Use it for | Example |
|---|---|---|
| **Base form** | The top-level record. Opened directly from the app's menu. | *Household*: one record per household visited |
| **Repeating child form** | Several records per parent record, usually a number the parent form asked for. | *Household member*: one record per person, repeated *nmembers* times |
| **One-off ("sister") form** | A single extra record attached to an existing parent, sometimes only for some parents. | *Vaccine coverage*: done only for enrollees with `vac_cov=1` |

Every survey needs at least one base form.

## Basic settings

| Setting | Meaning |
|---|---|
| **Display Name** | The form's name in the app, for example *Enrollment Form*. |
| **Table Name** | The form's technical name and database table, for example `enrollment`. Use lowercase letters, digits and underscores, starting with a letter. It must be unique in the survey. |
| **Parent Table** | Leave this as **None** for a base form. For a child or sister form, pick the parent form. |
| **Linking Field** | For a child or sister form: the field that connects it to its parent, usually the parent's ID, for example `hhid`. The field must exist on **both** forms. On the child, add it as a **Calculated** question with no calculation, and the app fills it in from the parent. |
| **Primary Key** | The field or fields that identify a record uniquely: `hhid` on a household form, or `hhid` + `linenum` on a household-member form. The app refuses a second record with the same key. |
| **Display Fields** | Fields shown in the app's record lists to help the interviewer find a record, for example `hhid` or `name`. |
| **Entry Condition** | For a child or sister form: limits which parent records it can be attached to. See below. |

![Form settings for a child form: names, display fields, parent table and linking field](/docs/img/designer/form-settings-basic.jpg)

## Automatic ID generation

A form can build a unique subject ID for each new record. First add a **Calculated** question with **no calculation** to hold it, for example `hhid`, and place it after the questions the ID is built from. Then, in the form's settings under *3. ID Generation*, tick **Enable automatic ID generation** and set:

- **ID Prefix**: fixed text at the start of every ID, for example `HH`.
- **Component Fields**: questions whose answers form part of the ID. Each one is padded with leading zeros to the **Length** you give. For example, a village code `7` with length 3 becomes `007`.
- **Increment Length**: the number of digits in the running number. For example, 3 gives `001`, `002`, … Set it to 0 if you don't want one.

**Example.** Prefix `HH`, component field `village` (length 3), increment length 4. The twelfth household in village 7 on a device gets the ID `HH0070012`. The app writes the ID into the holding question when the interviewer reaches it. Make that question the form's **Primary Key**.

![ID generation on a household form, built from four answered fields](/docs/img/designer/form-settings-id.jpg)

The running number is counted **on each device**, from the records already in that device's database. That is why the [Database Name](/docs/designer/survey-settings) must never change between versions. If several devices work in the same village, include a device or interviewer code as a component field so that IDs can't clash.

## Repeating child forms

For a child form that repeats, set the **Increment Field** under *3. ID Generation*, and the rest under *5. Auto-Repeat Logic*:

| Setting | Meaning |
|---|---|
| **Increment Field** | A field on the child form that numbers its records 1, 2, 3 … within each parent, for example `linenum`. Add it as a **Calculated** question with no calculation. |
| **Repeat Count Field** | A field on the **parent** form that says how many child records to expect, for example `nmembers`. |
| **Auto-Start Behavior** | What happens when the parent form is finished. **0 - Disabled**: the user adds child records manually. **1 - Prompt** (recommended): the app asks *"Add a record now?"*. **2 - Force**: the app starts the child form straight away. |
| **Enforce Count** | What happens if the number of child records doesn't match the count. **0 - Flexible**: no check. **1 - Warn** (recommended): show a warning. **2 - Force**: the user can't stop until the count is reached. **3 - Auto-sync**: update the parent's count to match. |

![Auto-repeat settings on a household-members form](/docs/img/designer/form-settings-repeat.jpg)

## One-off ("sister") forms and entry conditions

A sister form has a **Parent Table** and **Linking Field** but no increment or repeat settings. In the app, the user chooses the form and then picks which parent record it belongs to.

The **Entry Condition** filters that list of parents. It is a single `field=value` test on a field of the **parent** form, for example `enrolled=1`. Only parents where that field equals that value are offered. Only simple equality is supported: you can't use `<`, `>`, `AND` or `OR`. If you need more complex logic, add a calculated yes/no field to the parent form and test that.

The app doesn't prevent a second sister record for the same parent. If "only once" matters, cover it in your field procedures.

## End-of-survey message

The **Message** is shown after the last question, before the user taps **Finish**. Leave it blank to use the app's standard wording, which is translated automatically in the French version of the app. Text you type here is always shown exactly as written.

## Duplicating and deleting forms

From the form card's **⋮** menu:

- **Duplicate Form** copies the form and all its questions. The copy's table name ends in `_copy`.
- **Delete Form** removes the form and its questions. This can't be undone, although you can choose not to save.
