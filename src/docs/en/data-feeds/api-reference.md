# Feed API reference

This page is for whoever writes the program that reads a [data feed](/docs/data-feeds/overview). If you're connecting a dashboard built from the DataKollecta template, the template already does all of this. See [Tutorial: connecting a project dashboard](/docs/data-feeds/dashboard-setup).

## Requests

Every request is an HTTPS `GET` to the **feed URL** shown in the project's **Data feeds** card:

```
https://<datakollecta-project>.supabase.co/functions/v1/project-data-feed
```

Send the key in the `Authorization` header:

```
Authorization: Bearer dkf_3fa9c2d1_…
```

Choose what to read with the `resource` query parameter:

| `resource` | Returns |
|---|---|
| `forms` (default) | The forms the key can read |
| `submissions` | Records of one form |
| `formchanges` | The edit history of the records the key can read |

Every response is JSON and includes a `scope` object saying what the key can read:

```json
"scope": { "project": "prismcss2026", "survey_codes": ["prism_css"], "data_statuses": ["deployed"] }
```

## `resource=forms`

Lists each form once per survey, with the newest version's definition:

| Field | Meaning |
|---|---|
| `table_name` | The form's table name. Use it as `table=` when reading records. |
| `display_name` | The form's title |
| `parent_table`, `linking_field` | For a child form, its parent form and the field linking the two |
| `primary_key` | The form's ID field |
| `is_base` | `true` for a top-level form |
| `survey_code` | The survey the form belongs to |
| `versions` | The survey versions that include this form |
| `fields` | The form's questions, in questionnaire order |

Read parent forms before child forms. Ordering by `is_base` first does that.

## `resource=submissions`

| Parameter | Required | Meaning |
|---|---|---|
| `table` | Yes | The form's `table_name` |
| `since` | No | An ISO 8601 timestamp. Return only records **added or changed at or after** this time. Leave it out to start from the beginning. |
| `cursor` | No | The `next_cursor` from the previous page. Use it to continue reading. |
| `limit` | No | Rows per page, from 1 to 2000. The default is 1000. |

The response:

```json
{
  "scope": { … },
  "table": "hh_info",
  "rows": [
    {
      "survey_version": 2,
      "data_status": "deployed",
      "local_unique_id": "6f1c…",
      "surveyor_id": "worker07",
      "collected_at": "2026-10-02T09:14:55.120931",
      "submitted_at": "2026-10-02T11:02:13.4521+00:00",
      "hhid": "1010010101",
      "mrccode": "101",
      …
    },
    { "local_unique_id": "8a2e…", "_deleted": true }
  ],
  "next_cursor": "WyIyMDI2LTEw…",
  "last_changed_at": "2026-10-02T11:02:13.4521+00:00",
  "has_more": true
}
```

Each row holds the same leading columns as the CSV export, described in [Exporting data](/docs/data/export#whats-in-each-csv), followed by one key per question.

Rows come in the order they were last changed, oldest first. A record that changes again later is sent again, so **write rows by their ID (`local_unique_id` or `uniqueid`) and overwrite** rather than appending.

### Paging

While `has_more` is `true`, request the next page with `cursor=<next_cursor>` and the same `table`. When `has_more` is `false`, you have everything up to now.

To pick up only new changes on the next run, save the `last_changed_at` of the last page you read, and next time pass a time **a few minutes before it** as `since`.

> **Why a few minutes earlier?** A record that was being saved while you read can be stamped a moment before your last row and appear only after you've finished. Starting each run about 10 minutes back, and overwriting by ID, is safe and catches it. Re-reading a few records costs nothing.

### Tombstones

A row of the form `{"local_unique_id": "…", "_deleted": true}` is a **tombstone**. It means a record you may have received before is no longer readable with this key. The usual reason is that an owner [reclassified it as test](/docs/data/reclassify) and the key reads deployed data only. **Delete** that record from your copy.

Records are never deleted on the server, so a tombstone always means "no longer in scope", never "destroyed".

## `resource=formchanges`

Takes `since`, `cursor` and `limit`, the same as `submissions`, but no `table`. Each row has the same columns as `formchanges.csv` in an export, plus `synced_at`, the time the server received the change. It is written once and never changes. Rows are only returned for records the key can currently read.

## Errors

| Status | Meaning |
|---|---|
| `400` | A parameter is missing or invalid. The `error` field says which. |
| `401` | The key is missing, wrong, revoked or expired, or the project is archived. Every case returns the same message on purpose. |
| `405` | The request wasn't a `GET`. |
| `500` | A server error. Try again later. |

## Examples

### curl

```bash
curl -s -H "Authorization: Bearer $DK_FEED_KEY" "$DK_FEED_URL?resource=forms"
curl -s -H "Authorization: Bearer $DK_FEED_KEY" "$DK_FEED_URL?resource=submissions&table=hh_info&limit=100"
```

### JavaScript (Node 18 or later)

```js
const url = process.env.DK_FEED_URL;
const headers = { Authorization: `Bearer ${process.env.DK_FEED_KEY}` };

async function readTable(table, since) {
  const rows = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({ resource: "submissions", table, limit: "1000" });
    if (cursor) params.set("cursor", cursor);
    else if (since) params.set("since", since);
    const res = await fetch(`${url}?${params}`, { headers });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.json()).error}`);
    const page = await res.json();
    rows.push(...page.rows);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return rows;
}

const households = await readTable("hh_info");
console.log(households.filter((r) => !r._deleted).length, "households");
```

### Python

```python
import os, requests

URL = os.environ["DK_FEED_URL"]
HEADERS = {"Authorization": f"Bearer {os.environ['DK_FEED_KEY']}"}

def read_table(table, since=None):
    rows, cursor = [], None
    while True:
        params = {"resource": "submissions", "table": table, "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        elif since:
            params["since"] = since
        r = requests.get(URL, headers=HEADERS, params=params, timeout=60)
        r.raise_for_status()
        page = r.json()
        rows.extend(page["rows"])
        if not page["has_more"]:
            return rows
        cursor = page["next_cursor"]

households = [r for r in read_table("hh_info") if not r.get("_deleted")]
print(len(households), "households")
```
