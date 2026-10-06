# Response options

Single Select, Multi Select and Dropdown questions need a list of options. Set them on the question editor's **Responses** tab, which has two modes: **Static Options** and **Dynamic (CSV/DB)**.

## Static options

A fixed list that you type in. Each option has two parts:

- **Value (stored)**: the code saved in the data, for example `1`.
- **Label (displayed)**: the text the interviewer sees, for example *Female*.

Choose **Add Option** for each choice. Drag options to reorder them.

![Static response options](/docs/img/designer/responses-static.jpg)

Good practice:

- Use whole-number codes, numbered consistently: for example `1 = Yes, 2 = No`, everywhere in the survey.
- Don't reuse the special codes `-7` (Don't Know) and `-8` (Refuse) as normal options. Tick the boxes on the **Basic** tab instead.
- Each value must be unique within the question, and each label must be filled in.

## Dynamic options from a CSV file or the database

Use dynamic options when the list is long, shared between questions, or depends on earlier answers.

Choose **Dynamic (CSV/DB)**, then pick a **Data Source**:

- **CSV File** loads the options from a CSV file bundled with the survey. Upload the file first in [Survey settings → CSV data files](/docs/designer/survey-settings#csv-data-files).
- **Database Table** loads the options from records already collected on the device, for example *pick a household that was enumerated earlier*. Give the **Table Name** of the form to read from.

Then set:

| Setting | Meaning |
|---|---|
| **Display Column** | The column shown to the interviewer, for example `village_name`. |
| **Value Column** | The column saved as the answer, for example `village_code`. |
| **Filters** | Optional rules that narrow the list, as *Column  operator  Value*. The operators are `=`, `!=` and `like`. The value can be fixed text, or `[[field]]` to use an earlier answer. |
| **Distinct results** | Show each value only once, even if several rows have it. |
| **Empty Message** | Shown when no rows match, for example *No villages found for this district*. |
| **Don't Know Option** | Adds an extra *Don't Know* entry with the value you choose. |
| **Not in List Option** | Adds an extra *Not in list* entry, so the interviewer can record that the right answer wasn't offered. |

### Example: cascading district → village

`villages.csv` has the columns `district_code`, `village_code` and `village_name`.

1. Question `district`: a Dropdown with static options for each district.
2. Question `village`: a Dropdown with dynamic options from **CSV File** `villages.csv`.
   - Display Column `village_name`, Value Column `village_code`.
   - Filter: `district_code` `=` `[[district]]`.

The village list then only shows villages in the district chosen in the question before.

![A dynamic list from villages.csv, filtered by the region and MRC chosen earlier](/docs/img/designer/responses-dynamic.jpg)