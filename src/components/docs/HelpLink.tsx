import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { docHref, findDocPage } from "@/docs/nav";

interface HelpLinkProps {
  /** A docs page slug from `src/docs/nav.ts`, e.g. "people/field-team". */
  slug: string;
}

/**
 * A "?" icon that opens the matching documentation page in a new tab, so
 * reading the docs never costs the user their place (or unsaved work) here.
 */
export function HelpLink({ slug }: HelpLinkProps) {
  const title = findDocPage(slug)?.title ?? "Documentation";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={docHref(slug)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Help: ${title}`}
          className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <CircleHelp className="h-4 w-4" />
        </a>
      </TooltipTrigger>
      <TooltipContent>Help: {title}</TooltipContent>
    </Tooltip>
  );
}
