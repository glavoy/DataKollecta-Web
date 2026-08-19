# DataKollecta Web

DataKollecta is a comprehensive platform designed for research projects, field surveys, and clinical trials. It enables organizations to design complex surveys, manage field teams, and ensure data integrity across both offline and online environments.

See [DESIGN.md](DESIGN.md) for the full picture — system architecture, user roles, the data model, and the mobile-app API contract.

## Key Features

### 🚀 Survey Design Engine
*   **Visual Builder:** intuitive interface for creating and managing survey forms.
*   **Complex Logic:** Support for skip logic, validation rules, and specialized question types (text, date, single/multi-select, etc.).
*   **Form Management:** Version control, form duplication, and lifecycle management.

### 📊 Data Management & Project Overview
*   **Project Stats:** At-a-glance cards for survey, form, and record counts per project.
*   **Flexible Storage:** JSONB-based storage to accommodate varying survey structures without schema migrations.
*   **Export & Analysis:** Export submissions to CSV or a ZIP of CSVs for external analysis.
*   **Edit History:** Every field-level correction made after a record first syncs is tracked and viewable per record.
*   **Row-Level Security:** Strict data isolation ensures users only access data they are authorized to see.

### 👥 Team & Field Management
*   **Worker Credentials:** Manage dedicated credentials for field workers.
*   **Session Tracking:** Monitor active sessions and data collection activity.
*   **Offline-First:** Built-in support for offline data collection with robust synchronization and conflict resolution when connectivity is restored.





## Project Structure

*   `src/components`: Reusable UI components and feature-specific widgets.
    *   `src/components/survey-designer`: Core logic for the survey builder.
    *   `src/components/project`: Project detail sub-views (overview, data, settings).
    *   `src/components/projects`: The projects list.
    *   `src/components/teams`: Field-team credential management.
    *   `src/components/layout`: App shell (sidebar, navigation).
    *   `src/components/ui`: Shadcn UI primitives.
*   `src/pages`: Top-level route components (Projects, ProjectDetail, Login, SurveyDesignerPage, etc.).
*   `src/lib`: Utility functions, Supabase client setup, and XML generation logic.
*   `src/services`: Supabase-backed data access (projects, submissions, project members).
*   `src/types`: TypeScript definitions for surveys, forms, and data structures.
*   `src/hooks`: Custom React hooks (e.g., authentication, mobile detection).

