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

## Purging test records

Test records are hidden by default, so you don't have to remove them. If you'd rather not keep them, owners can **purge** them:

1. Open the form's records on the **Data** tab and choose the **Test** filter.
2. Tick the records to remove. The box in the header selects every record on every page.
3. Choose **Purge test records…**.
4. Enter a **Reason** (required), for example *Practice interviews from the training week, before deployment*.
5. Choose **Purge N records** to confirm.

Only records labelled *test* can be purged. Any *deployed* records in your selection are left alone. Deployed data can never be deleted.

What a purge does:

- The records disappear from the Data tab, exports and [data feeds](/docs/data-feeds/overview). A feed sends a tombstone for each one, so connected programs remove their copies.
- Their full content stays in the project's **audit trail**, with your name and reason. Nothing is lost beyond recovery.
- If a phone still holds a purged record and syncs it again, the server **ignores** it. It can't come back, and it can't come back labelled *deployed*.

If some selected records **arrived as deployed** and were later reclassified as test, the dialog warns you and shows how many. They can still be purged, but the audit trail flags them. Only go ahead if you're sure they are practice data.

A purge can't run while the project's [data lock](/docs/projects/settings) is on.

## Finding practice records

Practice records often stand out by:

- **Surveyor**: a username used only for testing. Consider keeping a separate credential such as `tester1` for this.
- **Collected** time: before the field launch date.
- **Values**: obvious test entries such as *Test Test* or repeated 9s.
