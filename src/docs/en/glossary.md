# Glossary

| Term | Meaning |
|---|---|
| **Archived** | A project hidden from the default Projects list, with field access blocked. It is reversible. |
| **Audit trail** | The server's permanent record of changes to project data and settings, and of every export, with who did it and why. |
| **Automatic field** | A field filled in by the app rather than asked, such as `starttime` or `uniqueid`. See [Automatic fields](/docs/designer/automatic-fields). |
| **Base form** | A top-level form with no parent, such as *Household*. |
| **Calculated question** | A question whose value is worked out automatically. See [Calculations](/docs/designer/calculations). |
| **Child form** | A form linked to a parent form, often repeated, such as *Household member*. |
| **Complete** | A survey status: collection has finished, the survey is no longer offered to phones, and the data is kept. |
| **CRF / form** | One questionnaire that saves to one table. Each form is one row in the survey's `crfs` list. |
| **Data feed key** | A read-only key, created by a project owner, that lets a program read one project's data automatically. See [Data feeds](/docs/data-feeds/overview). |
| **Data lock** | An owner's switch that stops any new records or changes from being accepted for a project. |
| **Database Name** | The file a survey's records are stored in on each device. It is shared by every version of a survey and must never change. |
| **Deployed** | A survey status: live in the field and locked. Also the label on records uploaded while a survey was live. |
| **Draft** | A survey status: being built, and not on any phone. |
| **Edit history** | The record of every change made to a record after it was first saved (`formchanges`). |
| **Entry condition** | A `field=value` rule limiting which parent records a sister form can be attached to. |
| **Field team / credential** | A username and password for the field app, created on the Field Team tab. |
| **Field Name** | A question's variable name, used in logic, exports and the database. |
| **GiSTX** | A separate build of the same field app that sends data to a file server instead of this website. |
| **Increment field** | A child-form field numbering its records 1, 2, 3 … within each parent, such as `linenum`. |
| **Linking field** | The field connecting a child record to its parent, such as `hhid`. |
| **Logic check** | A rule comparing answers. The interviewer can't continue while it is true. See [Validation](/docs/designer/validation). |
| **Manifest** | `survey_manifest.gistx` inside a survey package, which lists its forms and settings. Also `manifest.json` in an export, which lists file hashes. |
| **Member** | A website user with a role in a project: owner, editor or viewer. |
| **New Version** | A revision of a survey that shares its database and dataset. |
| **Paused** | A project whose field access is blocked while it stays in your list. |
| **Project code** | The short code field workers type to reach a project. It can't be changed. |
| **Record** | One completed form, such as one household or one person. |
| **Repeat count field** | A parent-form field saying how many child records to expect, such as `nmembers`. |
| **Sister form** | A one-off child form attached to an existing parent record. |
| **Skip logic** | Rules that route the interview past questions that don't apply. See [Skip logic](/docs/designer/skip-logic). |
| **Subject ID** | An ID the app generates from a prefix, field values and a running number. |
| **Survey** | A questionnaire, made of one or more forms, with one or more versions. |
| **Survey ID** | The unique name of one survey version, such as `household_2026_v2`. |
| **Survey package** | The ZIP holding a survey's form XML, manifest and CSV files. |
| **SurveyGen** | A command-line tool that builds survey packages from Excel. See [Building from Excel](/docs/designer/excel-surveygen). |
| **SurveyTest** | A desktop tool that runs simulated interviews against a package. |
| **Sync** | Uploading records and edit history from a device to the website. |
| **Tombstone** | A row in a data feed saying a record is no longer readable with that key, usually because it was reclassified as test or purged. The program should delete its copy. |
| **Test** | A survey status: downloadable and still editable. Also the label on records uploaded while a survey was in testing. |
