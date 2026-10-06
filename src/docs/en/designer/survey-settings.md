# Survey settings

Choose **Survey Settings** in the designer header to set the properties of the whole survey package.

## Survey identification

| Setting | What it is | Example |
|---|---|---|
| **Survey Name** | The friendly name field workers see in the app's survey list. | *Household Survey 2026* |
| **Survey ID** | A unique ID for this version. It becomes the package's file name and the folder the app installs it into. | `household_2026` |
| **Database Name** | The file the app stores this survey's records in, on each device. Must end in `.sqlite`. | `household_2026.sqlite` |

![The Global Survey Settings panel](/docs/img/designer/survey-settings.jpg)

**For version 2 onwards, Survey ID and Database Name are read-only.** The website assigns the new version's Survey ID (`household_2026_v2`) and keeps the Database Name, so that every version shares one dataset. See [Versions and duplicates](/docs/surveys/versions).

Rules for both IDs:

- Use lowercase letters, digits and underscores only.
- Don't put a version number into the Survey ID yourself. Use **New Version** instead.
- Choose a Database Name that is unique to this survey. Two different surveys can't share one.

## Form display order

This sets the order forms are listed in the field app's menu. Use the arrows to move a form up or down. The underlying numbers (10, 20, 30, …) are assigned for you.

Put the main (base) form first, then its child forms.

## CSV data files

CSV files let a dropdown load its options from a list, which is useful for long or shared lists such as villages, health facilities or drug names. See [Response options → Dynamic options](/docs/designer/responses#dynamic-options-from-a-csv-file-or-the-database).

- Choose **Add CSV Files** to upload one or more `.csv` files. They are bundled into the survey package.
- The first row must be column headers.
- Keep values simple: a comma inside a quoted value is fine, but a line break inside a value is not supported.

Choose **Save Settings** to apply your changes. Then **Save Draft** to store them in the project.
