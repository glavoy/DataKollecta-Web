import { useState, useEffect } from "react";
import { SurveyQuestion, QuestionType, FieldType } from "@/types/survey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import ResponseOptionsEditor from "./ResponseOptionsEditor";
import SkipLogicEditor from "./SkipLogicEditor";
import ValidationEditor from "./ValidationEditor";
import CalculationEditor from "./CalculationEditor";

interface QuestionEditorProps {
  question: SurveyQuestion | null;
  allQuestions: SurveyQuestion[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (question: SurveyQuestion) => void;
  /** Which tab to land on, e.g. when opened from an issues-panel finding. */
  initialTab?: 'basic' | 'responses' | 'validation' | 'logic';
}

// Helper to determine what configuration options to show based on question type and field type
const getFieldConfig = (questionType: QuestionType, fieldType: FieldType) => {
  const isTextInput = questionType === 'text';
  const isSelectType = ['radio', 'checkbox', 'combobox'].includes(questionType);
  const isDateType = ['date', 'datetime'].includes(questionType);
  const isCalculated = questionType === 'calculated';
  const isInformation = questionType === 'information';
  const isNumericField = ['text_integer', 'text_decimal'].includes(fieldType);
  const needsMaxChars = ['text', 'text_integer', 'text_decimal', 'hourmin'].includes(fieldType);

  return {
    // Basic tab options
    showMaxCharacters: isTextInput && needsMaxChars,
    showMask: isTextInput,
    showDontKnowRefuseNa: !isInformation && !isCalculated,

    // Responses tab
    showResponses: isSelectType,
    showCalculation: isCalculated,

    // Validation tab
    showNumericCheck: isTextInput && isNumericField,
    showDateRange: isDateType,
    showLogicCheck: !isInformation,
    showUniqueCheck: isTextInput,

    // Skip Logic tab
    showSkipLogic: true,

    // Whether to show field type selector (or auto-set)
    allowFieldTypeEdit: isTextInput || isCalculated,
  };
};

// Get default field type when question type changes
const getDefaultFieldType = (questionType: QuestionType): FieldType => {
  switch (questionType) {
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

// Get available field types for a question type
const getAvailableFieldTypes = (questionType: QuestionType): { value: FieldType; label: string }[] => {
  if (questionType === 'text') {
    return [
      { value: 'text', label: 'Text' },
      { value: 'text_integer', label: 'Integer (numeric input)' },
      { value: 'text_decimal', label: 'Decimal (numeric input)' },
      { value: 'hourmin', label: 'Hour:Minute' },
    ];
  }
  if (questionType === 'calculated') {
    return [
      { value: 'integer', label: 'Integer' },
      { value: 'text', label: 'Text' },
      { value: 'text_integer', label: 'Text Integer' },
      { value: 'date', label: 'Date' },
    ];
  }
  if (questionType === 'radio') {
    // The app stores a radio's answer as `integer`; `text` was offered here
    // but SurveyGen has always rejected it (radio requires integer), so this
    // dropdown was letting the designer author what the Excel path refuses.
    return [{ value: 'integer', label: 'Integer' }];
  }
  if (questionType === 'combobox') {
    return [
      { value: 'integer', label: 'Integer' },
      { value: 'text', label: 'Text' },
    ];
  }
  // For other types, return the default
  return [{ value: getDefaultFieldType(questionType), label: getDefaultFieldType(questionType) }];
};

/** Renders the stored width back as the '=N' shorthand authors type. */
const formatWidth = (value: number | undefined, fixed: boolean | undefined): string => {
  if (value === undefined) return '';
  return fixed ? `=${value}` : String(value);
};

/** '=10' -> exactly 10; '80' -> up to 80; anything else -> unset. */
const parseWidth = (raw: string): { value: number | undefined; fixed: boolean | undefined } => {
  const t = raw.trim();
  if (t === '') return { value: undefined, fixed: undefined };
  const fixed = t.startsWith('=');
  const n = Number(fixed ? t.slice(1) : t);
  if (!Number.isFinite(n)) return { value: undefined, fixed: undefined };
  return { value: n, fixed: fixed || undefined };
};

const QuestionEditor = ({ question, allQuestions, open, onOpenChange, onSave, initialTab }: QuestionEditorProps) => {
  // Initialize synchronously from prop to avoid render flash/null issues
  const [editedQuestion, setEditedQuestion] = useState<SurveyQuestion | null>(() =>
    question ? JSON.parse(JSON.stringify(question)) : null
  );
  const [activeTab, setActiveTab] = useState(initialTab ?? 'basic');

  // Land on the requested tab every time the sheet opens -- not just once on
  // mount, since the same editor instance is reused across every question.
  useEffect(() => {
    if (open) setActiveTab(initialTab ?? 'basic');
  }, [open, initialTab]);

  // Sync with prop when it changes
  useEffect(() => {
    if (question) {
      setEditedQuestion(JSON.parse(JSON.stringify(question)));
    }
  }, [question]);

  if (!editedQuestion) return null;

  const config = getFieldConfig(editedQuestion.type, editedQuestion.fieldtype);
  const availableFieldTypes = getAvailableFieldTypes(editedQuestion.type);

  const handleSave = () => {
    onSave(editedQuestion);
    onOpenChange(false);
  };

  const update = <K extends keyof SurveyQuestion>(field: K, value: SurveyQuestion[K]) => {
    setEditedQuestion(prev => prev ? { ...prev, [field]: value } : null);
  };

  // Handle question type change with auto field type setting
  const handleTypeChange = (newType: QuestionType) => {
    const newFieldType = getDefaultFieldType(newType);
    setEditedQuestion(prev => {
      if (!prev) return null;
      const updated: SurveyQuestion = {
        ...prev,
        type: newType,
        fieldtype: newFieldType,
      };
      // Clear responses if changing away from select types
      if (!['radio', 'checkbox', 'combobox'].includes(newType)) {
        updated.responses = undefined;
        updated.dynamicResponses = undefined;
      }
      // Initialize responses array for select types
      if (['radio', 'checkbox', 'combobox'].includes(newType) && !updated.responses) {
        updated.responses = [];
      }
      // Clear calculation if not calculated type
      if (newType !== 'calculated') {
        updated.calculation = undefined;
      }
      // Clear validation options that don't apply
      if (newType === 'information') {
        updated.dontKnow = undefined;
        updated.refuse = undefined;
        updated.na = undefined;
        updated.numericCheck = undefined;
        updated.dateRange = undefined;
        updated.logicCheck = undefined;
        updated.uniqueCheck = undefined;
      }
      return updated;
    });
  };

  // Get questions that appear before this one (for skip logic)
  const previousQuestions = allQuestions.filter(q => q.id !== editedQuestion.id);

  // Determine if we should show the Responses/Calculation tab
  const showMiddleTab = config.showResponses || config.showCalculation;
  const middleTabLabel = config.showCalculation ? 'Calculation' : 'Responses';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle>Edit Question</SheetTitle>
          <SheetDescription>
            Configure question properties, responses, validation, and logic
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="responses" disabled={!showMiddleTab}>
                {middleTabLabel}
              </TabsTrigger>
              <TabsTrigger value="validation">Validation</TabsTrigger>
              <TabsTrigger value="logic" disabled={!config.showSkipLogic}>Skip Logic</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 mt-4">
              {/* Question Type */}
              <div className="space-y-2">
                <Label>Question Type</Label>
                <Select
                  value={editedQuestion.type}
                  onValueChange={(v) => handleTypeChange(v as QuestionType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text Input</SelectItem>
                    <SelectItem value="radio">Single Select (Radio)</SelectItem>
                    <SelectItem value="checkbox">Multi Select (Checkbox)</SelectItem>
                    <SelectItem value="combobox">Dropdown (Combobox)</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="datetime">Date & Time</SelectItem>
                    <SelectItem value="information">Information (Read-only)</SelectItem>
                    <SelectItem value="calculated">Calculated (Auto-computed)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Field Name */}
              <div className="space-y-2">
                <Label>Field Name (Variable)</Label>
                <Input
                  value={editedQuestion.fieldname}
                  onChange={(e) => update('fieldname', e.target.value.replace(/\s/g, '_').toLowerCase())}
                  placeholder="e.g., participant_name"
                />
                <p className="text-xs text-muted-foreground">
                  Unique identifier used in logic and database. Lowercase, no spaces.
                </p>
              </div>

              {/* Field Type - only show when configurable */}
              {config.allowFieldTypeEdit && (
                <div className="space-y-2">
                  <Label>Data Type</Label>
                  <Select
                    value={editedQuestion.fieldtype}
                    onValueChange={(v) => update('fieldtype', v as FieldType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFieldTypes.map(ft => (
                        <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Question Text */}
              <div className="space-y-2">
                <Label>Question Text</Label>
                <Textarea
                  value={editedQuestion.text}
                  onChange={(e) => update('text', e.target.value)}
                  placeholder="Enter the question or label text..."
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Use [[fieldname]] to reference values from previous questions.
                </p>
              </div>

              {/* Max Characters - only for text types with appropriate field types */}
              {config.showMaxCharacters && (
                <div className="space-y-2">
                  <Label>Max Characters</Label>
                  <Input
                    value={formatWidth(editedQuestion.maxCharacters, editedQuestion.fixedLength)}
                    onChange={(e) => {
                      // The '=' prefix is UI shorthand for "exactly this many",
                      // stored as a separate flag rather than inside the number.
                      const { value, fixed } = parseWidth(e.target.value);
                      setEditedQuestion((prev) =>
                        prev ? { ...prev, maxCharacters: value, fixedLength: fixed } : null,
                      );
                    }}
                    placeholder="e.g., 80 or =10 for exact length"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use = prefix to enforce exact length (e.g., =10 means exactly 10 characters)
                  </p>
                </div>
              )}

              {/* Input Mask - only for text type */}
              {config.showMask && (
                <div className="space-y-2">
                  <Label>Input Mask (optional)</Label>
                  <Input
                    value={editedQuestion.mask ?? ''}
                    onChange={(e) => update('mask', e.target.value || undefined)}
                    placeholder="e.g., R21-[0-9][0-9][0-9]-[A-Z0-9][A-Z0-9]"
                  />
                  <p className="text-xs text-muted-foreground">
                    [0-9] = digit, [A-Z] = letter, [A-Z0-9] = alphanumeric. Literals auto-populate.
                  </p>
                </div>
              )}

              {/* Don't Know / Refuse options - for applicable types */}
              {config.showDontKnowRefuseNa && (
                <>
                  <Separator className="my-4" />
                  <Label className="text-sm font-medium">Special Response Values</Label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Add standard response options for respondents who cannot or choose not to answer.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs">Don't Know</Label>
                      <Input
                        value={editedQuestion.dontKnow ?? ''}
                        onChange={(e) => update('dontKnow', e.target.value || undefined)}
                        placeholder="-7"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Refuse to Answer</Label>
                      <Input
                        value={editedQuestion.refuse ?? ''}
                        onChange={(e) => update('refuse', e.target.value || undefined)}
                        placeholder="-8"
                      />
                    </div>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="responses" className="mt-4">
              {config.showResponses && (
                <ResponseOptionsEditor
                  responses={editedQuestion.responses || []}
                  dynamicResponses={editedQuestion.dynamicResponses}
                  onChange={(responses) => update('responses', responses)}
                  onDynamicChange={(dynamic) => update('dynamicResponses', dynamic)}
                />
              )}
              {config.showCalculation && (
                <CalculationEditor
                  calculation={editedQuestion.calculation}
                  availableFields={previousQuestions}
                  onChange={(calc) => update('calculation', calc)}
                />
              )}
            </TabsContent>

            <TabsContent value="validation" className="mt-4">
              <ValidationEditor
                questionType={editedQuestion.type}
                fieldtype={editedQuestion.fieldtype}
                numericCheck={editedQuestion.numericCheck}
                dateRange={editedQuestion.dateRange}
                logicCheck={editedQuestion.logicCheck}
                uniqueCheck={editedQuestion.uniqueCheck}
                onNumericCheckChange={(check) => update('numericCheck', check)}
                onDateRangeChange={(range) => update('dateRange', range)}
                onLogicCheckChange={(check) => update('logicCheck', check)}
                onUniqueCheckChange={(check) => update('uniqueCheck', check)}
              />
            </TabsContent>

            <TabsContent value="logic" className="space-y-6 mt-4">
              <SkipLogicEditor
                type="preskip"
                rules={editedQuestion.preskip || []}
                availableFields={allQuestions}
                onChange={(rules) => update('preskip', rules)}
              />
              <SkipLogicEditor
                type="postskip"
                rules={editedQuestion.postskip || []}
                availableFields={allQuestions}
                onChange={(rules) => update('postskip', rules)}
              />
            </TabsContent>
          </Tabs>
        </ScrollArea>

        <SheetFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Question
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default QuestionEditor;
