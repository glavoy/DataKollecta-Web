import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { SurveyPackage } from "@/types/survey";
import type { Finding, ValidationReport } from "@/lib/validation";

interface IssuesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ValidationReport;
  pkg: SurveyPackage;
  /** Switches to the finding's form, closes the panel, and opens the right editor on the right tab. */
  onJump: (finding: Finding) => void;
}

interface Group {
  key: string;
  label: string;
  findings: Finding[];
}

function groupFindings(report: ValidationReport, pkg: SurveyPackage): Group[] {
  const groups: Group[] = [];

  const packageLevel = report.findings.filter((f) => f.scope === "package");
  if (packageLevel.length > 0) {
    groups.push({ key: "__package__", label: "Survey Settings", findings: packageLevel });
  }

  for (const form of pkg.forms) {
    const findings = report.byFormId.get(form.id) ?? [];
    if (findings.length > 0) {
      groups.push({ key: form.id, label: form.displayname, findings });
    }
  }

  return groups;
}

/** Errors before warnings; within a severity, in question order. */
function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return (a.questionIndex ?? -1) - (b.questionIndex ?? -1);
  });
}

function FindingRow({ finding, onJump }: { finding: Finding; onJump: (f: Finding) => void }) {
  const isError = finding.severity === "error";
  return (
    <button
      type="button"
      onClick={() => onJump(finding)}
      className="w-full text-left flex items-start gap-2 p-2.5 rounded-lg hover:bg-muted/60 transition-colors"
    >
      {isError ? (
        <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {finding.questionIndex !== undefined && (
            <Badge variant="outline" className="text-[10px] px-1.5 h-4">
              Q{finding.questionIndex + 1}
            </Badge>
          )}
          {finding.fieldname && (
            <span className="font-mono text-xs text-muted-foreground truncate max-w-[160px]" title={finding.fieldname}>
              {finding.fieldname}
            </span>
          )}
        </div>
        <p className="text-sm mt-0.5">{finding.message}</p>
        {finding.hint && <p className="text-xs text-muted-foreground mt-0.5">{finding.hint}</p>}
      </div>
    </button>
  );
}

const IssuesPanel = ({ open, onOpenChange, report, pkg, onJump }: IssuesPanelProps) => {
  const groups = groupFindings(report, pkg);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle>Survey Issues</SheetTitle>
          <SheetDescription>
            {report.hasErrors
              ? `${report.errorCount} error${report.errorCount === 1 ? "" : "s"} must be fixed before this survey can be published.`
              : "No errors found."}
            {report.warningCount > 0 &&
              ` ${report.warningCount} warning${report.warningCount === 1 ? "" : "s"} to review.`}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6 mt-2">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p>Nothing to fix -- this survey is clean.</p>
            </div>
          ) : (
            <Accordion type="multiple" defaultValue={groups.map((g) => g.key)} className="w-full">
              {groups.map((group) => (
                <AccordionItem key={group.key} value={group.key}>
                  <AccordionTrigger className="text-sm">
                    <span className="flex items-center gap-2">
                      {group.label}
                      <Badge variant="secondary" className="text-[10px]">
                        {group.findings.length}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-1">
                    {sortFindings(group.findings).map((f, i) => (
                      <FindingRow key={i} finding={f} onJump={onJump} />
                    ))}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export default IssuesPanel;
