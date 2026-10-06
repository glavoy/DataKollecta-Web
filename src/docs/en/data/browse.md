# Viewing records

The project's **Data** tab shows everything that has been uploaded from the field. Every role can use it.

## Test, Deployed or All

The **Deployed / Test / All** buttons at the top choose which records you see. Each button shows a count. The default is **Deployed**, so practice interviews stay out of view until you ask for them. The choice applies to everything on the tab, including exports. See [Test and deployed records](/docs/data/reclassify).

## Surveys and forms

Each survey has a card showing:

- its forms and how many records each one has
- if a survey has several versions, *"N versions, merged"*. Records from every version are shown together.
- when you're viewing Deployed data, how many test records are hidden

Click a form to open its records.

![The Data tab, showing test data](/docs/img/data/data-tab.jpg)

## The records table

The table lists the form's records, most recently collected first, 25 per page. Use **Previous** and **Next** to move between pages. The columns are:

- **ID**: the start of the record's unique identifier, with a **Test** badge on test records
- **Surveyor**: the field-team username that uploaded the record
- **Collected**: when the interview took place, by the device's clock
- the first several of the form's own fields

Owners also see tick boxes for [reclassifying](/docs/data/reclassify) records.

![A form's records](/docs/img/data/records-table.jpg)

## Record details

Click the **eye** button on a row to open the full record:

- **Surveyor**, **Collected**, **Submitted** (when it reached the server), **Form**, and **Data** (Test or Deployed)
- every field and its value, in questionnaire order
- **History**, in two parts:
  - **Device history**: every correction made on the phone after the record was first saved. For each change it shows the field, the old and new values, who changed it, when, and the reason given.
  - **Server history**: each version of the record the server received, with the values that changed and the username that uploaded it. The uploader can differ from the person who made the edit offline. Records uploaded by older app versions may have no server history.

![A record's history](/docs/img/data/record-history.jpg)

![Record details](/docs/img/data/record-details.jpg)

## Across all projects

The **Data** link in the left sidebar gives totals across all your projects. See [The Data page](/docs/data/overview-page).
