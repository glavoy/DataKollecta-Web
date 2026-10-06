# Questions

Choose **Add Question** at the bottom of a form, then pick a question type. The question editor opens with four tabs: **Basic**, **Responses** (**Calculation** for calculated questions), **Validation** and **Skip Logic**. Choose **Save Question** when you're done.

## Question types

| Type | What the interviewer sees | Data types available |
|---|---|---|
| **Text Input** | A box to type into | Text · Integer (numeric input) · Decimal (numeric input) · Hour:Minute |
| **Single Select** | A list of options; pick one | Integer |
| **Multi Select** | A list of tick boxes; pick any number | Text |
| **Dropdown** | A searchable list; pick one. Good for long lists. | Integer · Text |
| **Date** | A date picker | Date |
| **Date & Time** | A date and time picker | Date & time |
| **Information** | Text to read, with no answer. Use it for instructions, section headings and consent statements. | — |
| **Calculated** | Nothing. The value is worked out automatically. See [Calculations](/docs/designer/calculations). | Integer · Text · Text Integer · Date |

You can change a question's type later in the **Basic** tab.

![Choosing a question type](/docs/img/designer/question-types.jpg)

## Basic tab

![The Basic tab of the question editor](/docs/img/designer/question-basic.jpg)

### Field Name

This is the variable name. It is used in logic, in exports, and as the column name in the database. For example: `age`, `hh_head_sex`, `visit_date`.

- Use **lowercase letters, digits and underscores** only, and start with a letter.
- Each name must be unique within the form.
- Some names are reserved because the app writes them itself: `uniqueid`, `starttime`, `lastmod` and the other [automatic fields](/docs/designer/automatic-fields).
- If the same field name appears on two forms (for example `hhid`, used to link a child form to its parent), it must be defined the same way on both.

New questions get a placeholder name such as `field_3fa9c1d2`, so give each one a meaningful name. If you rename a field later, every reference to it is updated for you.

### Question Text

This is the text the interviewer sees. To include an earlier answer, put its field name in double square brackets. For example, *"How old is [[member_name]]?"* shows the name that was entered earlier.

### Max Characters (Text Input)

The longest answer allowed. New text questions start at 80.

- Put `=` in front to require an **exact** length. For example, `=10` for a 10-digit phone number.
- Hour:Minute questions are always `=5` (`HH:MM`).

### Input Mask (Text Input, optional)

A pattern the answer must follow, for example `R21-[0-9][0-9][0-9]-[A-Z0-9][A-Z0-9]`.

- `[0-9]` stands for a digit, `[A-Z]` for a letter, and `[A-Z0-9]` for a letter or digit.
- Any other characters (like `R21-` above) are filled in automatically as the interviewer types.
- The mask's length must match Max Characters.

### Special response values

- **Don't Know** adds a *Don't Know* option, stored as `-7`.
- **Refuse to Answer** adds a *Refuse to Answer* option, stored as `-8`.

Use these codes everywhere, so they mean the same thing in every question and in your analysis. If a question also has a numeric range, add `-7, -8` to its **Other Allowed Values** (see [Validation](/docs/designer/validation)).

### Optional (Text Input only)

By default, every question must be answered before the interviewer can continue. Tick **Optional** to allow a text question to be left blank.

## The other tabs

- **[Responses](/docs/designer/responses)**: the options for Single Select, Multi Select and Dropdown questions.
- **[Calculation](/docs/designer/calculations)**: how a Calculated question gets its value.
- **[Validation](/docs/designer/validation)**: ranges, logic checks and uniqueness.
- **[Skip Logic](/docs/designer/skip-logic)**: when to skip this question, or where to jump after it.
