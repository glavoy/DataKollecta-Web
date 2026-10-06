# Field team

The **Field Team** tab manages the logins your data collectors use in the **field app**. They are separate from website accounts: a field-team login can't sign in to this website, and a website account can't sign in to the app.

## How a field worker signs in

In the field app, the field worker enters three things:

1. The **project code**, shown at the top of the project page, for example `household_2026`.
2. Their **username**, for example `surveyor1`.
3. Their **password**.

The app then downloads every survey in the project that is in **Test** or **Deployed** status. Each login gives access to **all** of the project's surveys. See [The field app and sync](/docs/field-app).

![The Field Team tab](/docs/img/people/field-team-tab.jpg)

## One login per person (or per device)

Every uploaded record is labelled with the username that uploaded it, which shows up as **Surveyor** on the Data tab. So we recommend:

- **One login per data collector.** You can see who collected each record, and you can cut off one person without affecting the others.
- Or **one login per device**, if devices are shared between collectors. Use the **Description** to record which device it is, for example *Tablet #3*.

## Add a credential

Owners and editors can manage the field team.

1. Choose **Add Credential**.
2. Enter a **Username**, for example `surveyor1`, and a **Password** of at least 10 characters. Use the eye icon to check what you typed.
3. Optionally add a **Description**, for example *Aisha, Kasese team* or *Tablet #3*.
4. Choose **Create Credential**.

![The Add Field Team Credential dialog](/docs/img/people/add-credential.jpg)

Give the username and password to the field worker privately. The password is stored securely and **can't be viewed again** later, but you can reset it.

## The credential list

For each credential, the list shows its **Username**, **Description**, **Last Used** (the last time it was used to sign in to the app; syncing does not update it) and **Status** (Active or Inactive). The search box filters by username or description.

Use the **⋮** menu on a row to:

![A credential's actions menu](/docs/img/people/credential-menu.jpg)

- **Edit**: change the username or description.
- **Reset password**: set a new password. **Every device signed in with this credential is signed out immediately**, and won't sync until the field worker enters the new password in the app's Settings. Use this if a password is shared or lost.
- **Disable / Enable**: temporarily block a credential without deleting it. New sign-ins are refused and its devices can't sync until you enable it again. For example, use this while a field worker is on leave.
- **Delete**: permanently remove the credential. Its access to the app is revoked immediately. Records it already uploaded are kept.

> **Before you reset, disable or delete a credential**, make sure its devices have synced. Records still on a phone can't upload until that phone has a working login again.

## Blocking the whole team at once

To stop field access for everyone in a project, for example while you fix a problem, **pause** the project on the [Settings](/docs/projects/settings#access-and-visibility) tab instead of disabling credentials one at a time.
