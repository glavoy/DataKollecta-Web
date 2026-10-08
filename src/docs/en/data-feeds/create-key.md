# Creating and revoking keys

Only a project **owner** can see, create or revoke [data feed keys](/docs/data-feeds/overview).

## Create a key

1. Open the project and go to the **Settings** tab.
2. In the **Data feeds** card, choose **Create key**.
3. Fill in the form:
   - **Name**: what the key is for, for example *PRISM CSS dashboard*. It appears in the list and in the audit trail.
   - **Surveys**: tick the surveys the key may read. Leave all of them unticked to allow every survey in the project, including surveys added later.
   - **Also include test data**: leave this off unless the program really needs practice records.
   - **Expires on** (optional): the key stops working at the end of this day.
4. Choose **Create key**.
5. **Copy the key now.** It looks like `dkf_3fa9c2d1_…` and is shown **only once**. If you lose it, revoke it and create a new one.

The **Feed URL** at the top of the card is the address the program sends the key to. It's the same for every project.

## Storing a key safely

Anyone who has the key can read the project's data, so:

- **Do** store it as a server-side secret, for example with `supabase secrets set DK_FEED_KEY=…`, a password manager, or your platform's secret store.
- **Don't** commit it to Git, paste it into chat or email, or put it in a spreadsheet.
- **Don't** put it in browser code or in a public environment variable (anything starting with `NEXT_PUBLIC_` or `VITE_`). Browser code is visible to every visitor.
- Create **one key per program**, so you can revoke one without breaking the others.

## The key list

Each key shows:

| Item | Meaning |
|---|---|
| `dkf_3fa9c2d1_…` | The start of the key, so you can tell keys apart. The rest is never shown again. |
| **Active / Expired / Revoked** | Whether the key works. |
| Surveys and data | What the key can read. |
| **Last used** | When a program last used the key, to the nearest minute. A key that hasn't been used for months is a good candidate for revoking. |

## Revoke a key

Revoke a key when the program no longer needs it, when someone who knew the key leaves, or if you think it has leaked.

1. Choose **Revoke** next to the key.
2. Enter a **reason**, for example *Dashboard retired* or *Key posted in a chat by mistake*.
3. Choose **Revoke key**.

The key stops working on the program's **next request**. Revoking can't be undone; create a new key if access is needed again. The reason is recorded in the audit trail.

## Rotate a key

To replace a key without interrupting the program:

1. Create a new key.
2. Update the program's stored secret to the new key.
3. Check that the program still works: the new key's **Last used** time updates.
4. Revoke the old key.

Archiving a project stops all its keys from working. Unarchiving it makes them work again. Pausing a project does **not** stop its keys, because pausing only blocks field collection.
