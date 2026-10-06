import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { DocsSidebar } from "@/components/docs/DocsSidebar";
import { MarkdownPage } from "@/components/docs/MarkdownPage";
import { adjacentDocPages, docHref, findDocPage } from "@/docs/nav";
import { extractHeadings, getDocSource } from "@/docs/content";

/**
 * Public documentation at /docs and /docs/<slug>. Deliberately outside
 * ProtectedRoute and AppLayout: field staff and prospective users read it
 * without a portal account.
 */
const Docs = () => {
  const params = useParams();
  const slug = (params["*"] ?? "").replace(/\/+$/, "");
  const { hash } = useLocation();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const page = findDocPage(slug);
  const source = page ? getDocSource(slug) : undefined;
  const headings = source ? extractHeadings(source).filter((h) => h.depth === 2) : [];
  const { prev, next } = adjacentDocPages(slug);

  useEffect(() => {
    document.title = page ? `${page.title} · DataKollecta Docs` : "DataKollecta Docs";
  }, [page]);

  // Jump to the anchor in the URL, or to the top on a page change.
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) {
        el.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [slug, hash]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-3">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open docs menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 overflow-y-auto">
                <SheetTitle className="mb-4">Documentation</SheetTitle>
                <DocsSidebar currentSlug={slug} onNavigate={() => setMenuOpen(false)} />
              </SheetContent>
            </Sheet>
            <Link to="/docs" className="flex items-center gap-3">
              <img src="/logo.png" alt="" className="h-10 w-auto" />
              <span className="font-semibold text-foreground">
                DataKollecta <span className="font-normal text-muted-foreground">Docs</span>
              </span>
            </Link>
          </div>
          <Button variant="outline" size="sm" asChild>
            {user ? <Link to="/app/projects">Back to the portal</Link> : <Link to="/login">Sign in</Link>}
          </Button>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-10 px-4 md:px-6">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 overflow-y-auto py-8 lg:block">
          <DocsSidebar currentSlug={slug} />
        </aside>

        <main className="min-w-0 flex-1 py-8 md:py-10">
          {source ? (
            <>
              <MarkdownPage source={source} />
              <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between">
                {prev ? (
                  <Link to={docHref(prev.slug)} className="group flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="h-4 w-4" />
                    <span>
                      <span className="block text-xs">Previous</span>
                      <span className="font-medium text-foreground">{prev.title}</span>
                    </span>
                  </Link>
                ) : <span />}
                {next && (
                  <Link to={docHref(next.slug)} className="group flex items-center gap-2 text-right text-sm text-muted-foreground hover:text-foreground sm:ml-auto">
                    <span>
                      <span className="block text-xs">Next</span>
                      <span className="font-medium text-foreground">{next.title}</span>
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </>
          ) : (
            <div className="py-20 text-center">
              <h1 className="mb-2 text-2xl font-bold">Page not found</h1>
              <p className="mb-6 text-muted-foreground">There is no documentation page at this address.</p>
              <Button asChild>
                <Link to="/docs">Go to the documentation home</Link>
              </Button>
            </div>
          )}
        </main>

        {headings.length > 1 && (
          <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 overflow-y-auto py-10 xl:block">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">On this page</p>
            <ul className="space-y-1.5 text-sm">
              {headings.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className="text-muted-foreground hover:text-foreground">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
};

export default Docs;
