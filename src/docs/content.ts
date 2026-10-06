/**
 * The Markdown source of every docs page, keyed by slug. Loaded eagerly, but
 * only the lazily-loaded Docs page imports this module, so none of it lands in
 * the main app bundle. English only for now; a second language would be a
 * sibling folder (`./fr/`) selected here.
 */
const files = import.meta.glob<string>("./en/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export function fileKeyForSlug(slug: string): string {
  return `./en/${slug || "index"}.md`;
}

export function getDocSource(slug: string): string | undefined {
  return files[fileKeyForSlug(slug)];
}

export const ALL_DOC_FILES: Record<string, string> = files;

export interface DocHeading {
  depth: number;
  text: string;
  id: string;
}

/** Same rule the renderer uses to give headings their anchor ids. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Level-2 and level-3 headings, skipping fenced code blocks. */
export function extractHeadings(markdown: string): DocHeading[] {
  const headings: DocHeading[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (m) {
      const text = m[2].replace(/[`*_]/g, "");
      headings.push({ depth: m[1].length, text, id: slugifyHeading(text) });
    }
  }
  return headings;
}
