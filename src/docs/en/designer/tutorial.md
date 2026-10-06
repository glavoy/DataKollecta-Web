# Tutorial: a household survey

This tutorial builds a small but realistic survey from start to finish. It has:

- a **Household** form that generates a household ID and asks how many people live there
- a **Household member** form that **repeats once for each person**
- a skip rule, a range check, a logic check and a calculated age

Allow about 30 minutes. You'll need a project where you are an owner or editor.

## 1. Create the survey

1. Open your project, go to the **Surveys** tab, and choose **Create New Survey**.
2. Choose **Survey Settings** and enter:
   - **Survey Name**: `Household Survey`
   - **Survey ID**: `household_tutorial`
   - **Database Name**: `household_tutorial.sqlite`
3. Choose **Save Settings**, then **Save Draft**.

## 2. Add the Household form

1. Choose **+** to add a form, then choose **Settings** on the new form's card.
2. Set **Display Name** to `Household` and **Table Name** to `household`. Leave **Parent Table** as *None*, because this is the base form.
3. Choose **Save Configuration**. You'll come back to finish the settings once the questions exist.

### Add its questions

Choose **Add Question** for each row below. Pick the type, then fill in the **Basic** tab.

| # | Type | Field Name | Question Text | Other settings |
|---|---|---|---|---|
| 1 | Text Input (Integer) | `village` | Village code | Max Characters `3`. **Validation**: range 1 to 999. |
| 2 | Calculated (Text) | `hhid` | Household ID | **No calculation.** The app writes the generated ID here (step 4 below). |
| 3 | Single Select | `consent` | Does the household agree to take part? | **Responses**: `1` Yes, `2` No |
| 4 | Text Input (Integer) | `nmembers` | How many people usually live in this household? | Max Characters `2`. **Validation**: range 1 to 30. |

### End the interview if consent is refused

1. Open `consent` and go to the **Skip Logic** tab.
2. Under **Post-Skip Logic**, choose **Add Rule** and set: **If** `consent` `=` `2` **then skip to** **End of Form**.
3. Choose **Save Question**.

## 3. Add the Household member form

1. Choose **+** to add a second form, then open its **Settings**.
2. Set:
   - **Display Name**: `Household member`
   - **Table Name**: `hh_member`
   - **Parent Table**: `household`
3. Choose **Save Configuration** for now. The remaining settings need questions to exist first.

### Add its questions

| # | Type | Field Name | Question Text | Other settings |
|---|---|---|---|---|
| 1 | Calculated (Text) | `hhid` | Household ID | **No calculation.** This is the linking field, and the app copies it from the household. |
| 2 | Calculated (Integer) | `linenum` | Line number | **No calculation.** This is the increment field, and the app numbers members 1, 2, 3 … |
| 3 | Text Input (Text) | `name` | What is this person's first name? | Max Characters `40` |
| 4 | Single Select | `sex` | Is [[name]] male or female? | **Responses**: `1` Male, `2` Female |
| 5 | Date | `dob` | What is [[name]]'s date of birth? | **Validation**: date range `-110y` to `0` |
| 6 | Calculated (Integer) | `age` | Age in years | **Calculation**: Age at Specific Date, DOB `dob`, reference `startdate`, unit Years |
| 7 | Single Select | `relation` | What is [[name]]'s relationship to the head of household? | **Responses**: `1` Head, `2` Spouse, `3` Child, `4` Other relative, `5` Not related |

Notice how `[[name]]` puts the person's name into the later questions.

### Add a logic check

The head of household should be at least 15.

1. Open `relation` and go to the **Validation** tab.
2. Choose **Add Check**:
   - **Condition Expression**: `relation = 1 AND age < 15`
   - **Error Message**: `The head of household must be 15 or older`

The condition describes the **wrong** answer. While it is true, the interviewer can't continue.

### Make it repeat

Open the Household member form's **Settings** again and set:

- **Increment Field**: `linenum`
- **Repeat Count Field**: `nmembers`, the question on the parent form
- **Auto-Start Behavior**: **1 - Prompt**
- **Enforce Count**: **1 - Warn**

Choose **Save Configuration**, then **Save Draft**.

Now, after a household interview, the app asks whether to start the member form. It numbers the members 1, 2, 3 … and warns if the number entered doesn't match `nmembers`.

## 4. Finish the form settings

### Household: generate the household ID

Open the **Household** form's **Settings** and set:

- **Primary Key** (under *3. ID Generation*): `hhid`
- Tick **Enable automatic ID generation**:
  - **ID Prefix**: `HH`
  - **Component Fields**: `village`, length `3`
  - **Increment Length**: `4`
- **Display Fields**: `hhid`. These fields identify each record in the app's record lists.

When the interviewer passes the `hhid` question, the app builds the ID from the prefix, the village code and the next free number on that device. Households in village 7 get `HH0070001`, `HH0070002`, and so on.

### Household member: link and number

Open the **Household member** form's **Settings** and set:

- **Linking Field**: `hhid`. It connects each member to their household.
- **Primary Key**: `hhid` and `linenum`
- **Display Fields**: `name`

Choose **Save Configuration**, then **Save Draft**.

## 5. Check, test and deploy

1. Open the **Issues** panel and fix anything listed.
2. **Promote to Test**, then run a few households on a phone. Include a refusal, and a household where the number of members doesn't match.
3. Sync, then check the **Data** tab with the **Test** filter.
4. When everything works, **Deploy**.

See [Testing and deploying](/docs/designer/test-and-deploy) for the full checklist.
