# Calculations

A **Calculated** question has no screen of its own. Its value is worked out automatically from other answers, and saved like any other field. Use calculations for ages, intervals, follow-up dates, derived flags, and to copy values between forms.

Add a question of type **Calculated**, open the **Calculation** tab, and choose a **Calculation Type**. Set the question's data type on the Basic tab to match the result: **Integer**, **Text**, **Text Integer** or **Date**.

## Calculation types

| Type | What it produces | Example |
|---|---|---|
| **Age at Specific Date** | Age in **years**, **months** or **days**, from a date-of-birth field to a reference date. The reference date is another field, or a **Fixed Date Instead**. | Age at enrolment: DOB field `dob`, reference field `startdate`, unit Years |
| **Date Difference** | The time between two dates, in years, months, weeks or days. Either date can be **Today**. | Days since last visit: start `last_visit`, end Today, unit Days |
| **Date Offset** | A date moved forward or back. Offsets are `+7d`, `-1m`, `+1y` and so on (`d` days, `w` weeks, `m` months, `y` years). | Follow-up due: source `visit_date`, offset `+28d` |
| **Date Part (Extract)** | One part of a date: Year (4-digit), Year (2-digit), Month, Day of month, or Day of year. | Enrolment year from `startdate` |
| **Conditional (If/Else)** | A value chosen by conditions: *if* `field` *op* `value` *then* result, checked in order, with an **Else (default) Result**. | `age_group`: if `age` < 5 then 1; if `age` < 15 then 2; else 3 |
| **Concatenate** | Several fields and fixed values joined together, with an optional **Separator**. | `full_id` = `village`-`hh_num` |
| **Math Expression** | Fields and values combined with one operator: **+**, **−**, **×** or **÷**. | `total_children` = `boys` + `girls` |
| **Constant Value** | A fixed value. | `study_arm` = `A` |
| **Lookup (Copy from Field)** | A copy of another field's value. | `contact_phone` = `phone1` |
| **SQL Query** | The result of a query on the device database, with `:param` placeholders filled from fields. For advanced use. | `SELECT COUNT(*) FROM hh_members WHERE hhid = :hhid` |

In Conditional, Concatenate and Math calculations, each part can be a **Field** or a **Value**. Packages built with SurveyGen can nest one calculation inside another. The designer shows nested parts but can't edit them.

![The calculation types](/docs/img/designer/calculation-types.jpg)

![A Conditional calculation: 1 if nmembers <= 3, otherwise 2](/docs/img/designer/calculation-conditional.jpg)

## When calculations update

A calculation is recomputed whenever the fields it depends on change. That includes when an interviewer goes back and corrects an earlier answer.

> **Need today's date parts, fixed when the record is created?** Don't use Date Part on today. Instead, add a question named `yyyy`, `yy`, `mm`, `dd` or `doy`. Those special field names are filled in automatically, and aren't changed when the record is edited later. See [Automatic fields](/docs/designer/automatic-fields).

## Using calculated values

A calculated field can be used anywhere an answer can: in question text (`[[age_years]]`), skip rules, logic checks, ID generation and filters. For example, calculate `age_years`, then use a pre-skip to route children and adults to different sections.

## Calculated questions with no calculation

A Calculated question can have **no calculation** when the app supplies its value itself. That applies to:

- a child form's **linking field**, copied from the parent record
- a child form's **increment field** (`linenum`), numbered 1, 2, 3 …
- the question that holds a **generated ID**, or any field named in the form's Primary Key or Display Fields
- the date-part names `yyyy`, `yy`, `mm`, `dd` and `doy`

Anywhere else, a Calculated question with no calculation is reported as an error, because nothing would ever give it a value. The designer also reports an error if a calculation is missing a required setting. See [Forms](/docs/designer/forms).
