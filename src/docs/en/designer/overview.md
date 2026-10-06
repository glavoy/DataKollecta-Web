# The Survey Designer

The Survey Designer is where you build questionnaires on the website. It produces the same survey package the field app installs, so you don't need any other tools.

To open it, go to a project's **Surveys** tab. Choose **Create New Survey** for a new survey, or the **Edit** (pencil) button on a Draft or Test survey.

![The Survey Designer with one form and three questions. The issues button shows two errors.](/docs/img/designer/designer-overview.jpg)

> Prefer to work in Excel? See [Building from Excel (SurveyGen)](/docs/designer/excel-surveygen).

## The layout

**The header** shows:

- the survey's name and Survey ID
- the **issues** button, with a count of errors and warnings
- **Survey Settings**: survey name, Survey ID, Database Name, form order and CSV files. See [Survey settings](/docs/designer/survey-settings).
- **Preview & Export**: view the generated files and download the package.
- **Save Draft** (or **Save** when the survey is in Test), **Promote to Test** and **Deploy**

**The form tabs** sit underneath the header, with one tab per [form](/docs/designer/forms). The **+** button adds a form. A red number on a tab is how many errors that form has.

**The form card** shows the form's display name, table name, number of questions and parent form. Its **Settings** button opens the form's configuration. The **⋮** menu has **Duplicate Form** and **Delete Form**.

**The question list** shows:

- The **automatic fields** at the top (`starttime`, `startdate`) and bottom (`uniqueid`, `lastmod` and others), which are greyed out. The designer adds these for you. See [Automatic fields](/docs/designer/automatic-fields).
- Your **questions**, in the order they're asked. **Drag** a question by its handle to reorder it. **Click** a question to edit it.
- **Add Question**, at the bottom of the list.

## The typical workflow

1. **Survey Settings.** Set the survey name, Survey ID and Database Name.
2. **Add a form**, and set its table name and display name in **Settings**.
3. **Add questions.** Pick a [question type](/docs/designer/questions), then fill in the question editor's tabs: **Basic**, **Responses** (or **Calculation**), **Validation** and **Skip Logic**.
4. **Add child forms** if you need repeating sections, such as one record per household member.
5. **Check the Issues panel** and fix every error.
6. **Save Draft** often.
7. **Promote to Test**, try the survey on a phone, fix anything you find, and **Save**.
8. **Deploy** when it's ready. See [Testing and deploying](/docs/designer/test-and-deploy).

New to all this? The [household survey tutorial](/docs/designer/tutorial) walks through every step.

## The Issues panel

The designer checks your survey as you work. Click the **errors · warnings** button in the header to open the **Survey Issues** panel, which lists each problem, where it is, and how to fix it. Clicking an issue takes you to the question it's about.

- **Errors** would stop the survey working on a phone. Examples are a blank field name, a skip rule pointing at a question that doesn't exist, or a single-select question with no options. **You can't Promote to Test or Deploy while there are errors.**
- **Warnings** are things that are allowed but probably a mistake, such as a Don't Know code that isn't the usual `-7`.

![The Survey Issues panel](/docs/img/designer/issues-panel.jpg)

## Saving and unsaved changes

- **Save Draft** / **Save** stores the survey in the project. *Unsaved changes* appears in the header when you have edits that aren't saved yet.
- Your browser also keeps a backup of unsaved work. If you close the tab or lose your connection, the next time you open the survey you'll be asked **Restore unsaved changes?**.
- **Renaming a field** updates every reference to it across the survey, including skip rules, logic checks, calculations and ID settings. A message tells you how many references were updated.

## Locked surveys

Deployed and Complete surveys open **read-only**, and a banner explains why. To change one, go back to the Surveys tab and create a [New Version](/docs/surveys/versions).

![A deployed survey open read-only](/docs/img/designer/designer-locked.jpg)