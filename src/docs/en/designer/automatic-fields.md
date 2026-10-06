# Automatic fields

Every form records some information without any question being asked. The designer adds these **automatic fields** for you. They are shown greyed out at the top and bottom of each form's question list, and you can't edit, move or delete them.

## Added to every form

| Field | Position | Holds |
|---|---|---|
| `starttime` | Before the first question | Date and time the interview started |
| `startdate` | Before the first question | Date the interview started |
| `uniqueid` | After the last question | A unique identifier for the record, created on the device. It links the record to its edit history and to the server. |
| `swver` | After the last question | Version of the field app that collected the record |
| `survey_id` | After the last question | Survey ID (version) of the questionnaire used |
| `lastmod` | After the last question | Date and time the record was last changed |
| `stoptime` | After the last question | Date and time the interview finished |

![A new form: the automatic fields are already in place](/docs/img/designer/automatic-fields.jpg)

## Added to child forms only

| Field | Holds |
|---|---|
| `parent_uniqueid` | The `uniqueid` of the parent record this child belongs to |

## End of form

Each form ends with an `end_of_questions` screen showing the form's [end-of-survey message](/docs/designer/forms#end-of-survey-message). The interviewer taps **Finish** on it to save the record.

## Date-part fields you can add

The field app also recognises five special field names. If you add a question (for example a Calculated question) with one of these names, it is filled in automatically from the device's date when the record is created, padded with leading zeros. It is **not** changed when the record is edited later.

| Field name | Value |
|---|---|
| `yyyy` | Four-digit year |
| `yy` | Two-digit year |
| `mm` | Month (`01`–`12`) |
| `dd` | Day of the month (`01`–`31`) |
| `doy` | Day of the year (`001`–`366`) |

These are handy as parts of a subject ID. For example, an ID prefix plus `yy` gives IDs that show the enrolment year.

## Reserved names

Don't use any of the automatic field names, or `end_of_questions`, as a field name for your own questions. The designer reports an error if you do.
