/**
 * The documentation's table of contents: the single source for the docs
 * sidebar, prev/next links and search. Each page's Markdown lives at
 * `src/docs/en/<slug>.md` (the home page, slug "", at `en/index.md`).
 *
 * A page added here without a file, or a `/docs/...` link to a page not
 * listed here, fails `src/docs/__tests__/docs.test.ts`.
 */
export interface DocPage {
  slug: string;
  title: string;
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    title: "Getting started",
    pages: [
      { slug: "", title: "What is DataKollecta?" },
      { slug: "how-it-works", title: "How it works" },
      { slug: "quick-start", title: "Quick start" },
      { slug: "concepts", title: "Key concepts" },
    ],
  },
  {
    title: "Your account",
    pages: [{ slug: "account", title: "Signing up and your account" }],
  },
  {
    title: "Projects",
    pages: [
      { slug: "projects/create", title: "Creating a project" },
      { slug: "projects/overview", title: "Projects list and Overview" },
      { slug: "projects/settings", title: "Project settings" },
    ],
  },
  {
    title: "People",
    pages: [
      { slug: "people/members", title: "Members" },
      { slug: "people/field-team", title: "Field team" },
      { slug: "people/roles", title: "Roles and permissions" },
    ],
  },
  {
    title: "Surveys",
    pages: [
      { slug: "surveys/overview", title: "Surveys and their status" },
      { slug: "surveys/versions", title: "Versions and duplicates" },
      { slug: "surveys/upload", title: "Uploading a survey package" },
      { slug: "surveys/delete", title: "Deleting a survey" },
    ],
  },
  {
    title: "Building surveys",
    pages: [
      { slug: "designer/overview", title: "The Survey Designer" },
      { slug: "designer/tutorial", title: "Tutorial: a household survey" },
      { slug: "designer/survey-settings", title: "Survey settings" },
      { slug: "designer/forms", title: "Forms" },
      { slug: "designer/questions", title: "Questions" },
      { slug: "designer/responses", title: "Response options" },
      { slug: "designer/validation", title: "Validation" },
      { slug: "designer/skip-logic", title: "Skip logic" },
      { slug: "designer/calculations", title: "Calculations" },
      { slug: "designer/automatic-fields", title: "Automatic fields" },
      { slug: "designer/test-and-deploy", title: "Testing and deploying" },
      { slug: "designer/excel-surveygen", title: "Building from Excel (SurveyGen)" },
    ],
  },
  {
    title: "Field app",
    pages: [{ slug: "field-app", title: "The field app and sync" }],
  },
  {
    title: "Data",
    pages: [
      { slug: "data/browse", title: "Viewing records" },
      { slug: "data/export", title: "Exporting data" },
      { slug: "data/reclassify", title: "Test and deployed records" },
      { slug: "data/overview-page", title: "The Data page" },
    ],
  },
  {
    title: "Help",
    pages: [
      { slug: "faq", title: "FAQ and troubleshooting" },
      { slug: "glossary", title: "Glossary" },
      { slug: "support", title: "Getting support" },
    ],
  },
];

export const DOC_PAGES: DocPage[] = DOC_SECTIONS.flatMap((s) => s.pages);

export function docHref(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

export function findDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((p) => p.slug === slug);
}

export function adjacentDocPages(slug: string): { prev?: DocPage; next?: DocPage } {
  const i = DOC_PAGES.findIndex((p) => p.slug === slug);
  if (i < 0) return {};
  return { prev: DOC_PAGES[i - 1], next: DOC_PAGES[i + 1] };
}
