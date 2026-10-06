import { existsSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { DOC_PAGES } from "@/docs/nav";
import { ALL_DOC_FILES, extractHeadings, fileKeyForSlug, getDocSource } from "@/docs/content";

const PUBLIC_DIR = path.resolve(__dirname, "../../../public");

// [text](/docs/...) and ![alt](/docs/img/...) links in every page.
function links(markdown: string): string[] {
  return [...markdown.matchAll(/\]\((\/docs[^)\s]*)\)/g)].map((m) => m[1]);
}

describe("documentation", () => {
  it("has a Markdown file for every page in the nav", () => {
    const missing = DOC_PAGES.filter((p) => getDocSource(p.slug) === undefined).map((p) => p.slug || "(home)");
    expect(missing).toEqual([]);
  });

  it("lists every Markdown file in the nav", () => {
    const listed = new Set(DOC_PAGES.map((p) => fileKeyForSlug(p.slug)));
    expect(Object.keys(ALL_DOC_FILES).filter((k) => !listed.has(k))).toEqual([]);
  });

  it("starts every page with a single level-1 heading", () => {
    for (const page of DOC_PAGES) {
      const src = getDocSource(page.slug) ?? "";
      expect(src.trimStart().startsWith("# "), page.slug).toBe(true);
    }
  });

  it("only links to pages, anchors and images that exist", () => {
    const broken: string[] = [];
    for (const page of DOC_PAGES) {
      for (const href of links(getDocSource(page.slug) ?? "")) {
        if (href.startsWith("/docs/img/")) {
          if (!existsSync(path.join(PUBLIC_DIR, href))) broken.push(`${page.slug}: ${href}`);
          continue;
        }
        const [route, anchor] = href.split("#");
        const slug = route.replace(/^\/docs\/?/, "");
        const target = getDocSource(slug);
        if (target === undefined || !DOC_PAGES.some((p) => p.slug === slug)) {
          broken.push(`${page.slug}: ${href}`);
        } else if (anchor && !extractHeadings(target).some((h) => h.id === anchor)) {
          broken.push(`${page.slug}: ${href} (no such heading)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
