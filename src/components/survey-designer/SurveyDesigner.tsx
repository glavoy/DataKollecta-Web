import { useEffect, useMemo, useState } from "react";
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
import QuestionEditor from "./QuestionEditor";
import FormManifestEditor from "./FormManifestEditor";
import XmlPreview from "./XmlPreview";
import GlobalSettingsEditor from "./GlobalSettingsEditor";
import { surveyService } from "@/services/surveyService";
import { useToast } from "@/hooks/use-toast";
import { validatePackage } from "@/lib/validation";

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

const createDefaultQuestion = (type: QuestionType): SurveyQuestion => ({
  id: crypto.randomUUID(),
  type,
  fieldname: `field_${Date.now()}`,
  fieldtype: getDefaultFieldType(type),
  text: '',
  responses: ['radio', 'checkbox', 'combobox'].includes(type) ? [] : undefined,
});

const createDefaultForm = (): SurveyForm => ({
  id: crypto.randomUUID(),
  tablename: `form_${Date.now()}`,
  displayname: 'New Form',
  displayOrder: 0,
  autoStartRepeat: 0,
  repeatEnforceCount: 1,
  questions: [],
});

interface SurveyDesignerProps {
  initialPackage?: SurveyPackage;
  onSave?: (pkg: SurveyPackage) => void;
  projectId?: string | null;
  projectSlug?: string;
  userId?: string;
}

const SurveyDesigner = ({ initialPackage, onSave, projectId, projectSlug, userId }: SurveyDesignerProps) => {
  const { toast } = useToast();
  const [surveyPackage, setSurveyPackage] = useState<SurveyPackage>(
    initialPackage || {
      id: crypto.randomUUID(),
      surveyId: `survey_${Date.now()}`,
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
  const [deleteFormId, setDeleteFormId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  // Sync state when initialPackage changes (e.g. after async load)
  useEffect(() => {
    if (initialPackage) {
      setSurveyPackage(initialPackage);
      if (initialPackage.forms.length > 0) {
        setActiveFormId(initialPackage.forms[0].id);
      }
    }
  }, [initialPackage]);

  const activeForm = surveyPackage.forms.find(f => f.id === activeFormId);

  const updatePackage = (updates: Partial<SurveyPackage>) => {
    const updated = { ...surveyPackage, ...updates };
    setSurveyPackage(updated);
    onSave?.(updated);
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

    try {
      setIsSaving(true);

      // Use surveyId from the package (which includes version info like geoff_css_2026-01-24)
      // If surveyId is empty, generate one from the display name
      const surveyDisplayName = surveyPackage.name || 'New Survey';
      const surveyName = surveyPackage.surveyId ||
        surveyDisplayName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

      await surveyService.saveSurveyPackage(
        surveyPackage,
        projectId,
        userId,
        surveyDisplayName,
        surveyName,
        status
      );

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
    updatePackage({
      forms: surveyPackage.forms.map(f =>
        f.id === formId ? { ...f, ...updates } : f
      )
    });
  };

  const addForm = () => {
    const newForm = createDefaultForm();
    newForm.displayOrder = surveyPackage.forms.length;
    updatePackage({ forms: [...surveyPackage.forms, newForm] });
    setActiveFormId(newForm.id);
  };

  const deleteForm = (formId: string) => {
    const remaining = surveyPackage.forms.filter(f => f.id !== formId);
    updatePackage({ forms: remaining });
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
    updatePackage({ forms: [...surveyPackage.forms, newForm] });
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
    setShowQuestionEditor(true);
  };

  const handleSaveQuestion = (question: SurveyQuestion) => {
    if (!activeForm) return;
    updateForm(activeFormId, {
      questions: activeForm.questions.map(q =>
        q.id === question.id ? question : q
      )
    });
  };

  const handleDuplicateQuestion = (question: SurveyQuestion) => {
    if (!activeForm) return;
    const index = activeForm.questions.findIndex(q => q.id === question.id);
    const newQuestion = {
      ...question,
      id: crypto.randomUUID(),
      fieldname: `${question.fieldname}_copy`,
    };
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
      {/* Package Header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div className="flex items-center gap-4">
          {projectSlug && (
            <Link to={`/app/projects/${projectSlug}?tab=surveys`}>
              <Button variant="ghost" size="icon" title="Back to Project">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
          )}
          <div
            className="text-lg font-semibold cursor-pointer hover:underline"
            onClick={() => setShowGlobalSettings(true)}
          >
            {surveyPackage.name || 'Untitled Survey'}
          </div>
          {surveyPackage.surveyId && (
            <Badge variant="outline">{surveyPackage.surveyId}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowGlobalSettings(true)}
            size="sm"
          >
            <Settings className="h-4 w-4 mr-2" />
            Survey Settings
          </Button>
          <Button
            variant="ghost"
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
          <Button variant="outline" onClick={() => setShowXmlPreview(true)}>
            <FileCode className="h-4 w-4 mr-2" />
            Preview & Export
          </Button>
          <Button
            variant={report.hasErrors ? "destructive" : "outline"}
            size="sm"
            title="Survey issues"
          >
            {report.hasErrors ? (
              <AlertCircle className="h-4 w-4 mr-2" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-500" />
            )}
            {report.errorCount} error{report.errorCount === 1 ? '' : 's'} · {report.warningCount} warning{report.warningCount === 1 ? '' : 's'}
          </Button>
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
                            setShowQuestionEditor(true);
                          }}
                          onDuplicate={() => handleDuplicateQuestion(question)}
                          onDelete={() => handleDeleteQuestion(question.id)}
                        />
                      );
                    })}
                  </SortableContext>
                </DndContext>

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
        onSave={setSurveyPackage}
      />

      {/* XML Preview Dialog */}
      <XmlPreview
        surveyPackage={surveyPackage}
        currentForm={activeForm || null}
        open={showXmlPreview}
        onOpenChange={setShowXmlPreview}
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
    </div>
  );
};

export default SurveyDesigner;
