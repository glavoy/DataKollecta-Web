import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DOC_PAGES, DOC_SECTIONS, docHref } from "@/docs/nav";
import { extractHeadings, getDocSource } from "@/docs/content";

interface SearchHit {
  slug: string;
  pageTitle: string;
  heading?: string;
  anchor?: string;
}

/** Plain substring search over page titles, then section headings. */
function searchDocs(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const page of DOC_PAGES) {
    if (page.title.toLowerCase().includes(q)) {
      hits.push({ slug: page.slug, pageTitle: page.title });
    }
  }
  for (const page of DOC_PAGES) {
    for (const h of extractHeadings(getDocSource(page.slug) ?? "")) {
      if (h.text.toLowerCase().includes(q)) {
        hits.push({ slug: page.slug, pageTitle: page.title, heading: h.text, anchor: h.id });
      }
    }
  }
  return hits.slice(0, 30);
}

interface DocsSidebarProps {
  currentSlug: string;
  onNavigate?: () => void;
}

export function DocsSidebar({ currentSlug, onNavigate }: DocsSidebarProps) {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchDocs(query), [query]);
  const searching = query.trim().length >= 2;

  return (
    <nav className="space-y-6 text-sm" aria-label="Documentation">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search docs"
          className="pl-8 pr-8"
          aria-label="Search documentation"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {searching ? (
        <div className="space-y-1">
          {hits.length === 0 && <p className="px-2 text-muted-foreground">No matches.</p>}
          {hits.map((hit, i) => (
            <Link
              key={`${hit.slug}-${hit.anchor ?? ""}-${i}`}
              to={`${docHref(hit.slug)}${hit.anchor ? `#${hit.anchor}` : ""}`}
              onClick={onNavigate}
              className="block rounded-md px-2 py-1.5 hover:bg-accent"
            >
              <span className="block font-medium text-foreground">{hit.heading ?? hit.pageTitle}</span>
              {hit.heading && <span className="block text-xs text-muted-foreground">{hit.pageTitle}</span>}
            </Link>
          ))}
        </div>
      ) : (
        DOC_SECTIONS.map((section) => (
          <div key={section.title}>
            <h4 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </h4>
            <ul className="space-y-0.5">
              {section.pages.map((page) => (
                <li key={page.slug}>
                  <Link
                    to={docHref(page.slug)}
                    onClick={onNavigate}
                    className={cn(
                      "block rounded-md px-2 py-1.5 transition-colors",
                      page.slug === currentSlug
                        ? "bg-secondary font-medium text-secondary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </nav>
  );
}
