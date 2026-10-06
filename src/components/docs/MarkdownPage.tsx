import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";
import { Link2 } from "lucide-react";
import { slugifyHeading } from "@/docs/content";

function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((c) => {
      if (typeof c === "string" || typeof c === "number") return String(c);
      if (isValidElement<{ children?: ReactNode }>(c)) return textOf(c.props.children);
      return "";
    })
    .join("");
}

function heading(Tag: "h2" | "h3") {
  return function Heading({ children }: { children?: ReactNode }) {
    const id = slugifyHeading(textOf(children));
    return (
      <Tag id={id} className="group scroll-mt-24">
        {children}
        <a
          href={`#${id}`}
          aria-label="Link to this section"
          className="ml-2 inline-block align-middle text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 no-underline"
        >
          <Link2 className="h-4 w-4" />
        </a>
      </Tag>
    );
  };
}

const components: Components = {
  h2: heading("h2"),
  h3: heading("h3"),
  a: ({ href = "", children }) => {
    if (href.startsWith("/") && !href.startsWith("//") && !/\.\w+$/.test(href)) {
      return <Link to={href}>{children}</Link>;
    }
    if (href.startsWith("#")) return <a href={href}>{children}</a>;
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => (
    <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noreferrer" className="block not-prose my-6">
      <img
        src={typeof src === "string" ? src : undefined}
        alt={alt ?? ""}
        loading="lazy"
        className="mx-auto h-auto max-w-full rounded-lg border border-border shadow-sm"
      />
      {alt && <span className="mt-2 block text-center text-sm text-muted-foreground">{alt}</span>}
    </a>
  ),
  table: ({ children }) => (
    <div className="not-prose my-6 overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-sm [&_td]:border-t [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-slate-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_code]:rounded [&_code]:bg-slate-200/70 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:text-slate-800">
        {children}
      </table>
    </div>
  ),
  blockquote: ({ children }) => (
    <div className="not-prose my-6 rounded-md border-l-4 border-primary bg-card shadow-sm px-4 py-3 text-sm leading-relaxed [&_p]:my-1 [&_code]:rounded [&_code]:bg-slate-200/70 [&_code]:px-1 [&_a]:text-primary [&_a]:underline">
      {children}
    </div>
  ),
};

interface MarkdownPageProps {
  source: string;
}

export function MarkdownPage({ source }: MarkdownPageProps) {
  return (
    <article className="prose prose-slate max-w-none prose-headings:scroll-mt-24 prose-a:text-primary prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-slate-200/70 prose-code:text-slate-800 prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-pre:bg-slate-800 prose-pre:text-slate-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </article>
  );
}
