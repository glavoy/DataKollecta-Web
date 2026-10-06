# Test and deployed records

Every record is labelled **test** or **deployed**. The label is the survey's status at the moment the record **first reached the server**:

- A record uploaded while its survey was in **Test** is labelled *test*.
- A record uploaded while its survey was **Deployed** (or Complete) is labelled *deployed*.

The server sets the label, not the phone, and syncing the record again later doesn't change it. The **Data** tab and every export show **deployed** data by default, so practice interviews stay out of your analysis.

## When a label is wrong

The usual cause is a tester's phone that **wasn't synced before the survey was deployed**. Its practice interviews reach the server afterwards and are labelled *deployed*. That's why the deploy dialog says *"Sync every test device first."*

Owners can correct labels:

1. Open the form's records on the **Data** tab. Choose the **All** filter if you aren't sure which label the records have now.
2. Tick the records to change. The box in the header selects every record on every page.
3. Choose **Reclassify…**.
4. Under **Mark as**, choose **Test** or **Deployed**.
5. Enter a **Reason** (required), for example *Training interviews by surveyor3 uploaded 2026-10-07 after deployment*.
6. Choose **Mark N records test** (or **deployed**) to confirm.

![Reclassifying two records](/docs/img/data/reclassify-dialog.jpg)

Reclassifying never changes the record's data, only its label. Each change is written to the project's audit trail with your name and reason.

## Finding practice records

Practice records often stand out by:

- **Surveyor**: a username used only for testing. Consider keeping a separate credential such as `tester1` for this.
- **Collected** time: before the field launch date.
- **Values**: obvious test entries such as *Test Test* or repeated 9s.
