import { Lock } from "lucide-react";

interface SystemFieldRowProps {
  fieldname: string;
  /** e.g. "Set automatically" or "Shown after the last question". */
  caption: string;
}

/**
 * A pinned, non-interactive strip for a reserved system field or the
 * end-of-survey screen -- starttime/startdate/uniqueid/etc plus
 * end_of_questions. These are never stored on `form.questions`
 * (`withSystemFields` adds them at generation time, see
 * `src/lib/xml/systemFields.ts`), so this is a synthetic display-only row,
 * not a `QuestionCard` variant: no id in the sortable list, no edit/
 * duplicate/delete, no question number. Deliberately smaller and quieter
 * than a real question card so authored content stays visually dominant.
 */
const SystemFieldRow = ({ fieldname, caption }: SystemFieldRowProps) => {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-dashed border-border bg-muted/30">
      <Lock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <span className="font-mono text-xs text-muted-foreground truncate">{fieldname}</span>
      <span className="text-xs text-muted-foreground/70 truncate">{caption}</span>
    </div>
  );
};

export default SystemFieldRow;
