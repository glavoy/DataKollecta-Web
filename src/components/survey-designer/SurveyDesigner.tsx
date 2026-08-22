import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom"; // Added Link
import { SurveyPackage, SurveyForm, SurveyQuestion, QuestionType } from "@/types/survey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Settings,
  FileCode,
  Trash2,
  MoreVertical,
  FileSpreadsheet,
  Copy,
  CloudUpload,
  Loader2,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import QuestionTypeSelector from "./QuestionTypeSelector";
import QuestionCard from "./QuestionCard";
import SystemFieldRow from "./SystemFieldRow";
import {
  LEADING_SYSTEM_FIELDS,
  TRAILING_SYSTEM_FIELDS,
  END_OF_QUESTIONS_FIELDNAME,
  GENERATED_END_TEXT,
} from "@/lib/xml/systemFields";
import QuestionEditor from "./QuestionEditor";
import FormManifestEditor from "./FormManifestEditor";
import XmlPreview from "./XmlPreview";
import GlobalSettingsEditor from "./GlobalSettingsEditor";
import IssuesPanel from "./IssuesPanel";
import { surveyService } from "@/services/surveyService";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { validatePackage, type Finding, type FindingPart } from "@/lib/validation";
import { useDraftMirror } from "@/hooks/useDraftMirror";
import { renameFieldAcrossPackage, renameInQuestion } from "@/lib/xml/rename";
import { surveyDraftKey, readDraft, clearDraft, evaluateDraft, type SurveyDraft } from "@/lib/draftStorage";

// Get default field type based on question type
const getDefaultFieldType = (type: QuestionType): SurveyQuestion['fieldtype'] => {
  switch (type) {
    case 'radio':
      return 'integer';
    case 'checkbox':
      return 'text';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'information':
      return 'n/a';
    case 'calculated':
      return 'integer';
    case 'combobox':
      return 'text';
    case 'text':
    default:
      return 'text';
  }
};

// `Date.now()` reads the same millisecond for two items created in a fast
// double-click or a duplicate-then-duplicate, producing identical
// fieldnames/tablenames -- the validation engine now catches the resulting
// duplicate, but the generator shouldn't produce it. A short random suffix
// derived from the same `crypto` already used for `id` is enough entropy to
// make a same-tick collision practically impossible without needing a
// counter to be threaded through and persisted anywhere.
const shortId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 8);

const createDefaultQuestion = (type: QuestionType): SurveyQuestion => ({
  id: crypto.randomUUID(),
  type,
  fieldname: `field_${shortId()}`,
  fieldtype: getDefaultFieldType(type),
  text: '',
  responses: ['radio', 'checkbox', 'combobox'].includes(type) ? [] : undefined,
  // 80 matches the overwhelming majority of free-text widths in real SurveyGen
  // output -- a starting point to adjust, not a rule to satisfy blindly.
  maxCharacters: type === 'text' ? 80 : undefined,
});

const createDefaultForm = (): SurveyForm => ({
  id: crypto.randomUUID(),
  tablename: `form_${shortId()}`,
  displayname: 'New Form',
  displayOrder: 0,
  autoStartRepeat: 0,
  repeatEnforceCount: 1,
  questions: [],
});

interface SurveyDesignerProps {
  initialPackage?: SurveyPackage;
  /** `survey_packages.updated_at` for `initialPackage`, if it came from the
   *  server -- the token the draft mirror compares against to decide
   *  whether a local draft is still sitting on top of what's live. */
  serverUpdatedAt?: string | null;
  /** The route's survey id, if editing an existing survey. Used only to key
   *  the local draft -- a new survey has no stable id to key on, see
   *  `surveyDraftKey`. */
  surveyRecordId?: string;
  projectId?: string | null;
  projectSlug?: string;
  userId?: string;
}

const SurveyDesigner = ({ initialPackage, serverUpdatedAt, surveyRecordId, projectId, projectSlug, userId }: SurveyDesignerProps) => {
  const { toast } = useToast();
  const [surveyPackage, setSurveyPackage] = useState<SurveyPackage>(
    initialPackage || {
      id: crypto.randomUUID(),
      surveyId: `survey_${shortId()}`,
      name: 'New Survey Package',
      forms: [createDefaultForm()],
      csvFiles: [],
    }
  );

  const [activeFormId, setActiveFormId] = useState<string>(surveyPackage.forms[0]?.id || '');
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<SurveyQuestion | null>(null);
  const [showQuestionEditor, setShowQuestionEditor] = useState(false);
  const [showFormSettings, setShowFormSettings] = useState(false);
  const [showXmlPreview, setShowXmlPreview] = useState(false);
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [initialEditorTab, setInitialEditorTab] = useState<'basic' | 'responses' | 'validation' | 'logic'>('basic');
  const [deleteFormId, setDeleteFormId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // True whenever `surveyPackage` holds edits the project doesn't have.
  // Drives the Save Draft/Publish affordance, the local draft mirror, and
  // the unsaved-changes warning on tab close -- cleared only on a
  // successful server save or when a freshly-loaded survey is adopted.
  const [dirty, setDirty] = useState(false);

  // The server's `updated_at` for whatever is currently the "clean"
  // baseline -- reset on load and after every successful save. This is what
  // the draft mirror stamps a local draft with, and what a later restore
  // compares against to know whether the server has moved on since.
  const baseServerUpdatedAtRef = useRef<string | null>(serverUpdatedAt ?? null);

  // Recomputed whenever the package object changes identity, which
  // updatePackage always does -- every edit replaces the whole object, so
  // this stays in sync without a separate effect or a debounce. Not
  // expensive: a few milliseconds of Map lookups even for a large survey.
  const report = useMemo(() => validatePackage(surveyPackage), [surveyPackage]);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const surveyKey = surveyDraftKey(surveyRecordId, projectId ?? null);
  const [pendingDraft, setPendingDraft] = useState<{ draft: SurveyDraft; staleBase: boolean } | null>(null);
  // Guards against the restore/discard dialog's own close animation firing
  // its onOpenChange a second time after an explicit button already handled
  // the choice -- see handleDiscardDraft.
  const draftHandledRef = useRef(false);

  // Adopt `initialPackage` only when the survey it represents actually
  // changes -- keyed on the package's own id, not on the prop's object
  // identity. A parent re-render that hands down the *same* survey again
  // (a token refresh used to do exactly this) must never overwrite whatever
  // the user has typed since. See AuthContext/SurveyDesignerPage for the
  // upstream fixes that make this a defense-in-depth guard rather than the
  // only thing standing between a refresh and lost work.
  const adoptedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialPackage) return;
    if (adoptedIdRef.current === initialPackage.id) return;
    adoptedIdRef.current = initialPackage.id;

    setSurveyPackage(initialPackage);
    setActiveFormId(initialPackage.forms[0]?.id ?? '');
    setDirty(false);
    baseServerUpdatedAtRef.current = serverUpdatedAt ?? null;

    if (!userId) return;
    const draft = readDraft(userId, surveyKey);
    const evaluation = evaluateDraft(draft, initialPackage, serverUpdatedAt ?? null);
    if (evaluation.kind === 'redundant') {
      clearDraft(userId, surveyKey);
    } else if (evaluation.kind === 'offer') {
      draftHandledRef.current = false;
      setPendingDraft({ draft: evaluation.draft, staleBase: evaluation.staleBase });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on initialPackage/serverUpdatedAt only; userId/surveyKey are read for the one-time draft check on adoption, not meant to re-run this
  }, [initialPackage, serverUpdatedAt]);

  useDraftMirror({
    enabled: dirty && !!userId,
    pkg: surveyPackage,
    userId,
    surveyKey,
    baseServerUpdatedAtRef,
  });

  // A close/refresh within the draft mirror's debounce window is the one
  // gap it can't cover on its own.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const activeForm = surveyPackage.forms.find(f => f.id === activeFormId);

  // Accepts either a partial to merge or an updater keyed off the previous
  // package -- functional so a burst of edits in one tick (or one render)
  // never silently drops one the way a plain `{...surveyPackage, ...x}`
  // closing over stale state would.
  const updatePackage = (
    update: Partial<SurveyPackage> | ((prev: SurveyPackage) => Partial<SurveyPackage>)
  ) => {
    setSurveyPackage(prev => ({ ...prev, ...(typeof update === 'function' ? update(prev) : update) }));
    setDirty(true);
  };

  const handleRestoreDraft = () => {
    if (!pendingDraft || draftHandledRef.current) return;
    draftHandledRef.current = true;
    const { draft } = pendingDraft;
    const restored: SurveyPackage = {
      ...draft.pkg,
      csvFiles: (surveyPackage.csvFiles ?? []).filter(f => draft.csvFilenames.includes(f.filename)),
    };
    setSurveyPackage(restored);
    setActiveFormId(restored.forms[0]?.id ?? '');
    setDirty(true); // restored work is still unsaved
    if (userId) clearDraft(userId, surveyKey);
    setPendingDraft(null);
  };

  const handleDiscardDraft = () => {
    // AlertDialogAction/Cancel both close the dialog themselves, which also
    // fires the AlertDialog's onOpenChange(false) below -- without this
    // guard, confirming Restore would run this discard path a beat later
    // and show "Local copy discarded" even though the restore just
    // succeeded. Reset alongside `pendingDraft` whenever a new offer starts.
    if (draftHandledRef.current) return;
    draftHandledRef.current = true;
    if (userId) clearDraft(userId, surveyKey);
    setPendingDraft(null);
    toast({ title: "Local copy discarded" });
  };

  const handleSaveToProject = async (status: 'draft' | 'active' = 'draft') => {
    if (!projectId || !userId) {
      toast({
        title: "Cannot save",
        description: "Missing project or user context.",
        variant: "destructive",
      });
      return;
    }

    // Save Draft never blocks -- a survey mid-edit is allowed to be broken.
    // Publish does: a broken survey reaching a field device is the one
    // outcome this whole engine exists to prevent.
    if (status === 'active' && report.hasErrors) {
      toast({
        title: "Cannot publish",
        description: `${report.errorCount} error${report.errorCount === 1 ? '' : 's'} must be fixed first.`,
        variant: "destructive",
        action: (
          <ToastAction altText="Review issues" onClick={() => setShowIssues(true)}>
            Review
          </ToastAction>
        ),
      });
      return;
    }

    try {
      setIsSaving(true);

      // Use surveyId from the package (which includes version info like geoff_css_2026-01-24)
      // If surveyId is empty, generate one from the display name
      const surveyDisplayName = surveyPackage.name || 'New Survey';
      const surveyName = surveyPackage.surveyId ||
        surveyDisplayName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

      const savedRow = await surveyService.saveSurveyPackage(
        surveyPackage,
        projectId,
        userId,
        surveyDisplayName,
        surveyName,
        status
      );

      setDirty(false);
      baseServerUpdatedAtRef.current = savedRow?.updated_at ?? null;
      if (userId) clearDraft(userId, surveyKey);

      toast({
        title: "Success",
        description: `Survey package ${status === 'active' ? 'published' : 'saved'} successfully.`,
      });
    } catch (error: any) {
      console.error('Error saving survey:', error);
      toast({
        title: "Error saving survey",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const updateForm = (formId: string, updates: Partial<SurveyForm>) => {
    updatePackage(prev => ({
      forms: prev.forms.map(f =>
        f.id === formId ? { ...f, ...updates } : f
      )
    }));
  };

  const addForm = () => {
    const newForm = createDefaultForm();
    newForm.displayOrder = surveyPackage.forms.length;
    updatePackage(prev => ({ forms: [...prev.forms, newForm] }));
    setActiveFormId(newForm.id);
  };

  const deleteForm = (formId: string) => {
    const remaining = surveyPackage.forms.filter(f => f.id !== formId);
    updatePackage(prev => ({ forms: prev.forms.filter(f => f.id !== formId) }));
    if (activeFormId === formId && remaining.length > 0) {
      setActiveFormId(remaining[0].id);
    }
    setDeleteFormId(null);
  };

  const duplicateForm = (form: SurveyForm) => {
    const newForm: SurveyForm = {
      ...form,
      id: crypto.randomUUID(),
      tablename: `${form.tablename}_copy`,
      displayname: `${form.displayname} (Copy)`,
      questions: form.questions.map(q => ({ ...q, id: crypto.randomUUID() })),
    };
    updatePackage(prev => ({ forms: [...prev.forms, newForm] }));
    setActiveFormId(newForm.id);
  };

  const handleAddQuestion = (type: QuestionType) => {
    if (!activeForm) return;
    const newQuestion = createDefaultQuestion(type);
    updateForm(activeFormId, {
      questions: [...activeForm.questions, newQuestion]
    });
    setShowAddQuestion(false);
    setEditingQuestion(newQuestion);
    setInitialEditorTab('basic');
    setShowQuestionEditor(true);
  };

  const handleSaveQuestion = (question: SurveyQuestion) => {
    if (!activeForm) return;

    const questions = activeForm.questions.map(q =>
      q.id === question.id ? question : q
    );

    const oldName = activeForm.questions.find(q => q.id === question.id)?.fieldname?.trim();
    const newName = question.fieldname?.trim();
    const renamed = !!oldName && !!newName && oldName.toLowerCase() !== newName.toLowerCase();

    if (!renamed) {
      updateForm(activeFormId, { questions });
      return;
    }

    // Rewrite every other reference to the old name -- skips, calculations,
    // [[placeholders]], and (on this form's children) entry_condition /
    // repeatCountField -- before the name is gone for good.
    const { pkg, count } = renameFieldAcrossPackage(
      { ...surveyPackage, forms: surveyPackage.forms.map(f => f.id === activeFormId ? { ...f, questions } : f) },
      activeFormId,
      oldName!,
      newName!
    );
    updatePackage(() => ({ forms: pkg.forms }));

    if (count > 0) {
      toast({
        title: `Renamed '${oldName}' to '${newName}'`,
        description: `Updated ${count} other reference${count === 1 ? '' : 's'} across the survey.`,
      });
    }
  };

  /** Which QuestionEditor tab a finding's `part` lives on. */
  const tabForPart = (part: FindingPart | undefined): typeof initialEditorTab => {
    switch (part) {
      case 'responses':
      case 'dynamicResponses':
      case 'calculation':
        return 'responses'; // same tab slot -- toggles between Responses/Calculation by question type
      case 'numericCheck':
      case 'dateRange':
      case 'logicCheck':
      case 'uniqueCheck':
        return 'validation';
      case 'preskip':
      case 'postskip':
        return 'logic';
      default:
        return 'basic'; // identity, text, maxCharacters, mask, specialAnswers
    }
  };

  const handleJumpToFinding = (finding: Finding) => {
    setShowIssues(false);

    if (finding.scope === 'package') {
      setShowGlobalSettings(true);
      return;
    }

    if (finding.formId) setActiveFormId(finding.formId);

    if (finding.questionId) {
      const form = surveyPackage.forms.find(f => f.id === finding.formId);
      const question = form?.questions.find(q => q.id === finding.questionId);
      if (question) {
        setEditingQuestion(question);
        setInitialEditorTab(tabForPart(finding.part));
        setShowQuestionEditor(true);
        return;
      }
    }

    // A form-scoped finding with no specific question -- e.g. a manifest
    // field or a linking-field problem.
    setShowFormSettings(true);
  };

  const handleDuplicateQuestion = (question: SurveyQuestion) => {
    if (!activeForm) return;
    const index = activeForm.questions.findIndex(q => q.id === question.id);
    const copyFieldname = `${question.fieldname}_copy`;
    // Fieldnames are unique within a form, so any reference to the OLD
    // fieldname inside the question being duplicated can only mean itself
    // (e.g. a self-check logicCheck) -- it must follow to the new name, or
    // the copy silently re-validates the original's answer.
    const { question: newQuestion } = renameInQuestion(
      { ...question, id: crypto.randomUUID(), fieldname: copyFieldname },
      question.fieldname,
      copyFieldname
    );
    const newQuestions = [...activeForm.questions];
    newQuestions.splice(index + 1, 0, newQuestion);
    updateForm(activeFormId, { questions: newQuestions });
  };

  const handleDeleteQuestion = (questionId: string) => {
    if (!activeForm) return;
    updateForm(activeFormId, {
      questions: activeForm.questions.filter(q => q.id !== questionId)
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!activeForm || !over || active.id === over.id) return;

    const oldIndex = activeForm.questions.findIndex(q => q.id === active.id);
    const newIndex = activeForm.questions.findIndex(q => q.id === over.id);

    const newQuestions = arrayMove(activeForm.questions, oldIndex, newIndex);
    updateForm(activeFormId, { questions: newQuestions });
  };

  return (
    <div className="h-full flex flex-col w-full max-w-full overflow-hidden">
      {/* Package Header -- identity row, then a divider, then an actions
          row. A single crowded row used to wrap the title across several
          lines at normal widths and shove every button sideways; splitting
          identity from actions gives the title room to just truncate. */}
      <div className="mb-4 flex-shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {projectSlug && (
              <Link to={`/app/projects/${projectSlug}?tab=surveys`} className="flex-shrink-0">
                <Button variant="ghost" size="icon" title="Back to Project">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
            )}
            <div className="min-w-0">
              <div
                className="text-lg font-semibold cursor-pointer hover:underline truncate"
                onClick={() => setShowGlobalSettings(true)}
                title={surveyPackage.name || 'Untitled Survey'}
              >
                {surveyPackage.name || 'Untitled Survey'}
              </div>
              {surveyPackage.surveyId && (
                <div className="text-xs text-muted-foreground truncate">{surveyPackage.surveyId}</div>
              )}
            </div>
          </div>
          <Button
            variant={report.hasErrors ? "destructive" : "outline"}
            size="sm"
            title="Survey issues"
            onClick={() => setShowIssues(true)}
            className="flex-shrink-0"
          >
            {report.hasErrors ? (
              <AlertCircle className="h-4 w-4 mr-2" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-500" />
            )}
            {report.errorCount} error{report.errorCount === 1 ? '' : 's'} · {report.warningCount} warning{report.warningCount === 1 ? '' : 's'}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowGlobalSettings(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Survey Settings
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowXmlPreview(true)}>
              <FileCode className="h-4 w-4 mr-2" />
              Preview & Export
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <span className="text-xs text-muted-foreground">Unsaved changes</span>
            )}
            <Button
              variant="outline"
              onClick={() => handleSaveToProject('draft')}
              disabled={!projectId || isSaving}
              size="sm"
            >
              Save Draft
            </Button>
            <Button
              variant="default"
              onClick={() => handleSaveToProject('active')}
              disabled={!projectId || isSaving}
              size="sm"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CloudUpload className="h-4 w-4 mr-2" />
              )}
              Publish
            </Button>
          </div>
        </div>
      </div>


      {/* Forms Tabs */}
      <Tabs value={activeFormId} onValueChange={setActiveFormId} className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-4 flex-shrink-0">
          <TabsList className="h-auto flex-wrap">
            {surveyPackage.forms.map((form) => {
              const formErrorCount = (report.byFormId.get(form.id) ?? []).filter(
                (f) => f.severity === 'error',
              ).length;
              return (
                <TabsTrigger key={form.id} value={form.id} className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  {form.displayname}
                  {formErrorCount > 0 && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 h-4 min-w-4 flex items-center justify-center">
                      {formErrorCount}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
          <Button variant="outline" size="sm" onClick={addForm}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {surveyPackage.forms.map((form) => (
          <TabsContent key={form.id} value={form.id} className="flex-1 flex flex-col mt-0 h-full overflow-hidden data-[state=inactive]:hidden">
            {/* Form Header */}
            <Card className="mb-4 bg-card border-border">
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">{form.displayname}</CardTitle>
                    <CardDescription>
                      {form.tablename}.xml • {form.questions.length} questions
                      {form.parenttable && ` • Child of ${form.parenttable}`}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowFormSettings(true)}>
                      <Settings className="h-4 w-4 mr-1" />
                      Settings
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => duplicateForm(form)}>
                          <Copy className="h-4 w-4 mr-2" />
                          Duplicate Form
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDeleteFormId(form.id)}
                          className="text-destructive"
                          disabled={surveyPackage.forms.length <= 1}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Form
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Questions List */}
            <div className="flex-1 w-full overflow-y-auto min-h-0">
              <div className="space-y-3 pr-4 w-full pb-4">
                {/* Leading system fields -- never part of form.questions, so
                    they render outside the sortable list entirely: they
                    can't be dragged and can't be a drop target, which is
                    what actually keeps a real question from landing above
                    startdate (a disabled sortable item would still be a
                    droppable collision target). */}
                <p className="text-xs text-muted-foreground px-1">
                  Added automatically when the survey is generated
                </p>
                {LEADING_SYSTEM_FIELDS.map((f) => (
                  <SystemFieldRow key={f.fieldname} fieldname={f.fieldname} caption="Set automatically" />
                ))}

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={form.questions.map(q => q.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {form.questions.map((question, index) => {
                      const questionFindings = report.byQuestionId.get(question.id) ?? [];
                      return (
                        <QuestionCard
                          key={question.id}
                          question={question}
                          index={index}
                          errorCount={questionFindings.filter((f) => f.severity === 'error').length}
                          warningCount={questionFindings.filter((f) => f.severity === 'warning').length}
                          onEdit={() => {
                            setEditingQuestion(question);
                            setInitialEditorTab('basic');
                            setShowQuestionEditor(true);
                          }}
                          onDuplicate={() => handleDuplicateQuestion(question)}
                          onDelete={() => handleDeleteQuestion(question.id)}
                        />
                      );
                    })}
                  </SortableContext>
                </DndContext>

                {/* Trailing system fields + the end-of-survey screen -- same
                    reasoning as the leading block, mirrored: a new question
                    (handleAddQuestion appends to form.questions) lands above
                    this group automatically, with no insert-position logic
                    needed. */}
                {TRAILING_SYSTEM_FIELDS.map((f) => (
                  <SystemFieldRow key={f.fieldname} fieldname={f.fieldname} caption="Set automatically" />
                ))}
                <SystemFieldRow
                  key={END_OF_QUESTIONS_FIELDNAME}
                  fieldname={END_OF_QUESTIONS_FIELDNAME}
                  caption={form.endOfQuestionsText?.trim() || GENERATED_END_TEXT}
                />

                {form.questions.length === 0 && !showAddQuestion && (
                  <Card className="bg-muted/30 border-dashed border-2">
                    <CardContent className="py-8 text-center">
                      <p className="text-muted-foreground mb-4">
                        No questions yet. Add your first question to get started.
                      </p>
                      <Button onClick={() => setShowAddQuestion(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Question
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Add Question Section */}
                {showAddQuestion ? (
                  <Card className="bg-card border-border">
                    <CardHeader>
                      <CardTitle className="text-base">Select Question Type</CardTitle>
                      <CardDescription>Choose the type of input for this question</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <QuestionTypeSelector onSelect={handleAddQuestion} />
                      <Button
                        variant="ghost"
                        className="mt-4 w-full"
                        onClick={() => setShowAddQuestion(false)}
                      >
                        Cancel
                      </Button>
                    </CardContent>
                  </Card>
                ) : form.questions.length > 0 && (
                  <Button
                    variant="outline"
                    className="w-full border-dashed"
                    onClick={() => setShowAddQuestion(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Question
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Question Editor Sheet */}
      <QuestionEditor
        question={editingQuestion}
        allQuestions={activeForm?.questions || []}
        open={showQuestionEditor}
        onOpenChange={setShowQuestionEditor}
        onSave={handleSaveQuestion}
        initialTab={initialEditorTab}
        csvFiles={surveyPackage.csvFiles}
      />

      {/* Issues Panel */}
      <IssuesPanel
        open={showIssues}
        onOpenChange={setShowIssues}
        report={report}
        pkg={surveyPackage}
        onJump={handleJumpToFinding}
      />

      {/* Form Settings Sheet */}
      {activeForm && (
        <FormManifestEditor
          form={activeForm}
          allForms={surveyPackage.forms}
          open={showFormSettings}
          onOpenChange={setShowFormSettings}
          onSave={(updatedForm) => updateForm(activeFormId, updatedForm)}
        />
      )}

      {/* Global Settings Sheet */}
      <GlobalSettingsEditor
        surveyPackage={surveyPackage}
        open={showGlobalSettings}
        onOpenChange={setShowGlobalSettings}
        onSave={(pkg) => updatePackage(pkg)}
      />

      {/* XML Preview Dialog */}
      <XmlPreview
        surveyPackage={surveyPackage}
        currentForm={activeForm || null}
        open={showXmlPreview}
        onOpenChange={setShowXmlPreview}
        report={report}
        onReviewIssues={() => {
          setShowXmlPreview(false);
          setShowIssues(true);
        }}
      />

      {/* Delete Form Confirmation */}
      <AlertDialog open={!!deleteFormId} onOpenChange={() => setDeleteFormId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Form?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the form and all its questions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteFormId && deleteForm(deleteFormId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore Unsaved Changes -- a blocking dialog rather than a
          dismissible banner. A banner would let editing continue on a
          package that's about to be replaced, and "restore" would then
          destroy whatever was typed after the reload; the decision is one
          click, so it isn't worth that risk. */}
      <AlertDialog open={!!pendingDraft} onOpenChange={(open) => !open && handleDiscardDraft()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  You have unsaved changes to &quot;{pendingDraft?.draft.pkg.name || 'this survey'}&quot; from{' '}
                  {pendingDraft && new Date(pendingDraft.draft.savedAt).toLocaleString()} that were never saved to
                  the project.
                </p>
                {pendingDraft?.staleBase && (
                  <p>
                    This project was also saved elsewhere since. Restoring will replace what&apos;s currently on
                    screen with your local copy.
                  </p>
                )}
                {pendingDraft && pendingDraft.draft.csvFilenames.some(
                  (name) => !(surveyPackage.csvFiles ?? []).some((f) => f.filename === name)
                ) && (
                  <p>
                    CSV files added since the last save can&apos;t be recovered and will need re-uploading.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDiscardDraft}>Discard local copy</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestoreDraft}>Restore changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SurveyDesigner;
