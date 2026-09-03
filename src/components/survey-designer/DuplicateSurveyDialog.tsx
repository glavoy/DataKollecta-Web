import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle } from "lucide-react";
import { surveyService } from "@/services/surveyService";
import { findSurveyIdConflict, surveyIdConflictMessage, translateSurveyWriteError } from "@/lib/errors/surveyErrors";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors/getErrorMessage";

interface DuplicateSurveyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: {
    id: string;
    surveyId: string;
    displayName: string;
    databaseName?: string;
  };
  projectId: string;
  userId?: string;
  projectSlug?: string;
}

/** `prism_css_test_2026_08_22` -> `prism_css_test_2026_08_23`, following the
 *  team's own `_YYYY_MM_DD` versioning convention. Falls back to appending
 *  `_copy` when the source id doesn't end in a recognizable date. */
function suggestNextSurveyId(sourceId: string): string {
  const match = sourceId.match(/^(.*_)(\d{4})_(\d{2})_(\d{2})$/);
  if (!match) return `${sourceId}_copy`;

  const [, prefix, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  date.setUTCDate(date.getUTCDate() + 1);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${prefix}${yyyy}_${mm}_${dd}`;
}

const DuplicateSurveyDialog = ({ open, onOpenChange, source, projectId, userId, projectSlug }: DuplicateSurveyDialogProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [surveyId, setSurveyId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [databaseName, setDatabaseName] = useState('');
  const [databaseNameTouched, setDatabaseNameTouched] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const suggestedId = suggestNextSurveyId(source.surveyId);
    setSurveyId(suggestedId);
    setDisplayName(`${source.displayName} (Copy)`);
    setDatabaseName(`${suggestedId}.sqlite`);
    setDatabaseNameTouched(false);
    setConflict(null);
  }, [open, source.surveyId, source.displayName]);

  // Database name follows the Survey ID field as it's typed, until the user
  // edits it directly -- see the design note on duplicateSurveyPackage for
  // why the default is a NEW database rather than the source's.
  useEffect(() => {
    if (!databaseNameTouched) setDatabaseName(`${surveyId}.sqlite`);
  }, [surveyId, databaseNameTouched]);

  // Debounced live conflict check so the user never hits the error on submit.
  useEffect(() => {
    if (!open || !surveyId.trim() || !userId) return;
    setChecking(true);
    const handle = setTimeout(async () => {
      try {
        const found = await findSurveyIdConflict(surveyId.trim(), projectId, userId, { excludeId: source.id });
        setConflict(found ? surveyIdConflictMessage(found) : null);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => {
      clearTimeout(handle);
      setChecking(false);
    };
  }, [open, surveyId, projectId, userId, source.id]);

  const handleDuplicate = async () => {
    if (!userId || !surveyId.trim() || !displayName.trim()) return;
    setSaving(true);
    try {
      const saved = await surveyService.duplicateSurveyPackage({
        sourceId: source.id,
        targetProjectId: projectId,
        newSurveyId: surveyId.trim(),
        newDisplayName: displayName.trim(),
        databaseName: databaseName.trim() || undefined,
        userId,
      });

      toast({
        title: "Survey duplicated",
        description: `"${displayName.trim()}" was created as a new draft.`,
      });
      onOpenChange(false);

      if (projectSlug) {
        navigate(`/app/projects/${projectSlug}/surveys/${saved.id}`);
      }
    } catch (error) {
      toast({
        title: "Could not duplicate survey",
        description: translateSurveyWriteError(error) ?? getErrorMessage(error, "An unexpected error occurred."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = !!surveyId.trim() && !!displayName.trim() && !conflict && !checking && !saving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate survey</DialogTitle>
          <DialogDescription>
            Creates a new, independent draft with a new Survey ID -- all forms, questions, and
            CSV files carry over. "{source.displayName}" itself is unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="dup-survey-id">Survey ID</Label>
            <Input
              id="dup-survey-id"
              value={surveyId}
              onChange={(e) => setSurveyId(e.target.value)}
              placeholder="e.g. prism_css_2026_08_23"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dup-display-name">Display name</Label>
            <Input
              id="dup-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dup-database-name">Database name</Label>
            <Input
              id="dup-database-name"
              value={databaseName}
              onChange={(e) => {
                setDatabaseNameTouched(true);
                setDatabaseName(e.target.value);
              }}
            />
            <p className="text-xs text-muted-foreground">
              A new database keeps this copy's records separate from "{source.displayName}" on
              the phone. Only reuse the original's database name ({source.databaseName ?? `${source.surveyId}.sqlite`})
              if this is meant to continue the same survey's ID counters -- sharing a database
              between two different surveys' schemas will corrupt data.
            </p>
          </div>

          {conflict && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{conflict}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleDuplicate} disabled={!canSubmit}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DuplicateSurveyDialog;
