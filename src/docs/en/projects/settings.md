# Project settings

The project's **Settings** tab has four sections: **Data lock**, **General**, **Access & Visibility** and the **Danger Zone**. Anyone in the project can see them, but **only owners can change them**.

## Data lock

Locking the data stops **any new records or changes** from being accepted for this project. That includes uploads from devices that were offline when you locked. You can still view and export everything.

Use the data lock at the end of a study, or before a formal data review, to freeze the dataset.

![The Data lock card](/docs/img/projects/data-lock.jpg)

1. Type a **reason**, for example *"Database lock for final analysis, approved by PI 2026-10-01"*.
2. Choose **Lock data**.

To reopen the data, enter a reason and choose **Reopen data**. Both actions are recorded in the project's audit trail with your reason. If data is corrected after you reopen it, get the dataset endorsed again before analysis.

## General

- **Project Name** and **Description** can be edited. Choose **Save Changes** when you're done.
- **Project Code** is shown but can't be changed. Field workers use it to sign in.

## Access and visibility

This control has three states. The change takes effect **immediately**, with no Save button.

| State | Field app | Your Projects list | Website |
|---|---|---|---|
| **Active** | Field workers can sign in, download surveys and upload data. | Shown | Fully usable |
| **Paused** | **Blocked.** New sign-ins are refused, and a device that is already signed in loses access the next time it syncs. | Shown | Fully usable |
| **Archived** | **Blocked**, the same as Paused. | Hidden. Use the **Archived** filter to find it. | Fully usable |

![The Access & Visibility control](/docs/img/projects/access-visibility.jpg)

- **Pause** a project when you need to stop field access for a while but are still working on it. For example, you might be fixing a problem before fieldwork resumes.
- **Archive** a project when the study is over.
- Choosing **Active** on an archived project unarchives it and restores field access straight away.

If the project has a deployed survey, you'll be asked to confirm before pausing or archiving, because devices in the middle of collecting data will lose access at their next sync.

> Neither pausing nor archiving deletes or locks anything. You can still edit surveys, manage people and export data. To stop the data itself from changing, use the data lock.

## Danger Zone: deleting a project

**Delete Project** permanently removes a project, but **only an empty one**. If a project contains collected records or audit history, you can't delete it, and you must archive it instead. This protects collected data from being destroyed by accident.

To confirm, type the project code and choose **Delete Project**.
