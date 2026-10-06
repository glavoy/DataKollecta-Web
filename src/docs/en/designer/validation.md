# Validation

Validation stops impossible or inconsistent answers at the moment of the interview, while the respondent is still there. Set it on the question editor's **Validation** tab. Which options appear depends on the question's type.

## Numeric range

For number questions (Text Input with Integer or Decimal):

1. Tick **Enable Numeric Range Check**.
2. Set a **Minimum Value** and a **Maximum Value**. Both are required.
3. In **Other Allowed Values**, list any codes that are allowed outside the range, separated by commas. These are usually the special codes `-7, -8`.
4. Write an **Error Message**, for example *Age must be between 0 and 120*.

![A numeric range with the special codes allowed](/docs/img/designer/validation-range.jpg)

## Date range

For Date and Date & Time questions, tick **Enable Date Range**, then set a **Minimum Date** and a **Maximum Date**. Each can be:

- a fixed date: `2025-01-01`
- **today**: `0`
- a date **relative to today**: a number with `d` (days), `w` (weeks), `m` (months) or `y` (years). For example, `-100y` means 100 years ago and `+1m` means one month from now.

**Example.** For a date of birth, use minimum `-100y` and maximum `0`. That allows any date from 100 years ago up to today.

## Custom logic checks

Logic checks compare an answer with other answers. Choose **Add Check**, then write a **Condition Expression** and an **Error Message**.

> **Write the condition that is *wrong*.** While the expression is **true**, the error message is shown and the interviewer can't continue. When it becomes false, they can move on.

| You want to enforce | Condition Expression | Error Message |
|---|---|---|
| Age 18–65 | `age < 18 OR age > 65` | *Participant must be aged 18 to 65* |
| Dose 2 after dose 1 | `dose2_date < dose1_date` | *Dose 2 can't be before dose 1* |
| Head of household is an adult | `relation = 1 AND age < 15` | *The head of household must be 15 or older* |

- You can use `=`, `<>` (not equal), `<`, `>`, `<=`, `>=`, `AND` and `OR`. Use brackets to group conditions.
- Refer to other questions by their field name. They must be **earlier** questions on the same form, because a later question has no answer yet. Automatic date fields such as `startdate` can be used too.
- Dates can be compared with each other, or with a date in quotes: `visit_date > '2026-01-31'`.
- Checks run in order, and the first one that fails is the one shown.

![A logic check. The condition describes the wrong answer.](/docs/img/designer/validation-logic-check.jpg)

The designer warns you if a check names a field that doesn't exist, comes later in the form, or compares a coded question with a value that isn't one of its codes.

## Require unique value

Tick **Require Unique Value** to reject an answer that already exists in another record of this form on the device. This is useful for barcodes, screening numbers or phone numbers. Write an **Error Message**, for example *This barcode has already been used*.

## Other built-in checks

Some checks need no setup:

- **Max Characters** and **exact length** (`=10`), from the Basic tab.
- **Input mask** patterns.
- Answers are **required** unless the question is marked Optional.
