# The field app and sync

This page explains how the field app connects to the website. To learn how to run interviews on the phone, see the field app's own *DataKollecta User Guide*.

## Signing in

In the app's **Settings**, a field worker adds a project by entering:

- the **project code** (shown on the project page, for example `household_2026`)
- their **field-team username** and **password**, created on the [Field Team](/docs/people/field-team) tab

A device can hold several projects, each signed in separately.

Sign-in fails if:

- the project code, username or password is wrong
- the credential has been **disabled** or **deleted**
- the project is **Paused** or **Archived** (see [Project settings](/docs/projects/settings#access-and-visibility))

## Getting surveys

When signed in, the app is offered every survey in the project whose status is **Test** or **Deployed**. Test surveys appear as `[TEST] Survey name`. The field worker downloads the ones they need from the app's Sync Center.

- A survey moved to **Complete** is no longer offered. Devices that already have it can keep using it.
- A newly deployed survey or version reaches a device at its **next sign-in**. Sign-in sessions last up to 30 days.

## Working offline

After download, the app needs no connection to collect data. Records and their edit history are stored on the device. Subject IDs are generated on the device too. See [Forms → Automatic ID generation](/docs/designer/forms#automatic-id-generation).

## Syncing

When the device is online, the field worker uploads from the Sync Center. Each upload sends:

- **new and changed records**, labelled with the uploading username
- each record's **edit history**: what changed, when, by whom, and the reason, if one was given

Uploads are safe to repeat. If a sync is interrupted, the next sync resends whatever didn't arrive, and records are never duplicated.

Records appear on the project's [Data](/docs/data/browse) tab as soon as the sync finishes.

### When an upload is refused

| The app reports | Cause | Fix |
|---|---|---|
| Sign-in needed / session expired | The session ended, or the credential's password was reset | Sign in again in Settings |
| Access revoked | The credential was disabled or deleted, or the project was paused or archived | Re-enable the credential or reactivate the project |
| Project data locked | An owner [locked the data](/docs/projects/settings#data-lock) | The owner reopens the data. Records wait safely on the device until then. |

Records that can't upload stay on the device, so nothing is lost. Just resolve the cause and sync again.

## Getting the app

Ask your project's DataKollecta contact for the current Android installer (APK) and installation instructions.
