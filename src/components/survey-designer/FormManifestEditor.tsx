import { useState, useEffect } from "react";
import { SurveyForm, IdConfig, SurveyQuestion } from "@/types/survey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Info, X } from "lucide-react";

interface FormManifestEditorProps {
  form: SurveyForm;
  allForms: SurveyForm[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (form: SurveyForm) => void;
}

// Info tooltip component
const InfoTooltip = ({ text }: { text: string }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-4 w-4 text-muted-foreground cursor-help inline-block ml-1" />
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <p className="text-sm">{text}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

// Multi-field selector component
const FieldSelector = ({
  label,
  tooltip,
  availableFields,
  selectedFields,
  onChange,
}: {
  label: string;
  tooltip: string;
  availableFields: SurveyQuestion[];
  selectedFields: string[];
  onChange: (fields: string[]) => void;
}) => {
  const [selectValue, setSelectValue] = useState<string>("");

  const addField = (fieldname: string) => {
    if (fieldname && !selectedFields.includes(fieldname)) {
      onChange([...selectedFields, fieldname]);
    }
    setSelectValue("");
  };

  const removeField = (fieldname: string) => {
    onChange(selectedFields.filter(f => f !== fieldname));
  };

  const unusedFields = availableFields.filter(
    q => !selectedFields.includes(q.fieldname)
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center">
        <Label>{label}</Label>
        <InfoTooltip text={tooltip} />
      </div>

      {/* Selected fields */}
      {selectedFields.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selectedFields.map(field => (
            <Badge key={field} variant="secondary" className="gap-1">
              {field}
              <button
                type="button"
                onClick={() => removeField(field)}
                className="hover:bg-muted rounded-full"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Add field selector */}
      <Select value={selectValue} onValueChange={addField}>
        <SelectTrigger>
          <SelectValue placeholder="Add a field..." />
        </SelectTrigger>
        <SelectContent>
          {unusedFields.length === 0 ? (
            <SelectItem value="_none_" disabled>No fields available</SelectItem>
          ) : (
            unusedFields.map(q => (
              <SelectItem key={q.fieldname} value={q.fieldname}>
                {q.fieldname} {q.text ? `- ${q.text.substring(0, 30)}...` : ''}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      <p className="text-xs text-muted-foreground">
        Selected: {selectedFields.length > 0 ? selectedFields.join(', ') : 'None'}
      </p>
    </div>
  );
};

const FormManifestEditor = ({ form, allForms, open, onOpenChange, onSave }: FormManifestEditorProps) => {
  const [editedForm, setEditedForm] = useState<SurveyForm>({ ...form });
  // Store idconfig separately to preserve it when toggling
  const [savedIdConfig, setSavedIdConfig] = useState<IdConfig | null>(form.idconfig || null);

  // Reset when opening with a new form
  useEffect(() => {
    if (open) {
      setEditedForm({ ...form });
      setSavedIdConfig(form.idconfig || null);
    }
  }, [open, form]);

  const update = <K extends keyof SurveyForm>(field: K, value: SurveyForm[K]) => {
    setEditedForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(editedForm);
    onOpenChange(false);
  };

  // Handle idconfig toggle - preserve values
  const handleIdConfigToggle = (enabled: boolean) => {
    if (enabled) {
      // Restore saved config or create default
      update('idconfig', savedIdConfig || { prefix: '', fields: [], incrementLength: 3 });
    } else {
      // Save current config before disabling
      if (editedForm.idconfig) {
        setSavedIdConfig(editedForm.idconfig);
      }
      update('idconfig', undefined);
    }
  };

  const updateIdConfig = (updates: Partial<IdConfig>) => {
    const current = editedForm.idconfig || { prefix: '', fields: [], incrementLength: 3 };
    const updated = { ...current, ...updates };
    update('idconfig', updated);
    setSavedIdConfig(updated); // Keep saved in sync
  };

  const addIdField = () => {
    const current = editedForm.idconfig || { prefix: '', fields: [], incrementLength: 3 };
    updateIdConfig({
      fields: [...current.fields, { name: '', length: 2 }]
    });
  };

  const updateIdField = (index: number, field: 'name' | 'length', value: string | number) => {
    if (!editedForm.idconfig) return;
    const newFields = [...editedForm.idconfig.fields];
    newFields[index] = { ...newFields[index], [field]: value };
    updateIdConfig({ fields: newFields });
  };

  const removeIdField = (index: number) => {
    if (!editedForm.idconfig) return;
    updateIdConfig({
      fields: editedForm.idconfig.fields.filter((_, i) => i !== index)
    });
  };

  // Parse display_fields and primaryKey from comma-separated strings
  const parseFieldList = (value: string | undefined): string[] => {
    if (!value) return [];
    return value.split(',').map(f => f.trim()).filter(f => f.length > 0);
  };

  const formatFieldList = (fields: string[]): string | undefined => {
    if (fields.length === 0) return undefined;
    return fields.join(',');
  };

  const otherForms = allForms.filter(f => f.id !== form.id);
  // Normalize parenttable - treat empty string as undefined
  const normalizedParentTable = editedForm.parenttable && editedForm.parenttable.trim() !== ''
    ? editedForm.parenttable
    : undefined;
  const isChildForm = !!normalizedParentTable;

  // Get all available fields from the form's questions
  const availableFields = editedForm.questions || [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle>Form Configuration</SheetTitle>
          <SheetDescription>
            Configure form manifest settings for the mobile app
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <Accordion type="multiple" defaultValue={["basic", "hierarchy"]} className="w-full">
            {/* 1. Basic Identification */}
            <AccordionItem value="basic">
              <AccordionTrigger>1. Basic Identification</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center">
                    <Label>Display Name</Label>
                    <InfoTooltip text="Human-readable form name shown to users in the mobile app." />
                  </div>
                  <Input
                    value={editedForm.displayname}
                    onChange={(e) => update('displayname', e.target.value)}
                    placeholder="e.g., Enrollment Form"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center">
                    <Label>Table Name</Label>
                    <InfoTooltip text="Unique identifier that matches the XML filename (without extension). Used as the database table name." />
                  </div>
                  <Input
                    value={editedForm.tablename}
                    onChange={(e) => update('tablename', e.target.value.replace(/\s/g, '_').toLowerCase())}
                    placeholder="e.g., enrollment"
                  />
                </div>

                <FieldSelector
                  label="Display Fields"
                  tooltip="Fields shown in the record list view on the mobile app. Select fields that help identify records (e.g., name, ID)."
                  availableFields={availableFields}
                  selectedFields={parseFieldList(editedForm.displayFields)}
                  onChange={(fields) => update('displayFields', formatFieldList(fields))}
                />
              </AccordionContent>
            </AccordionItem>

            {/* 2. Hierarchy & Navigation */}
            <AccordionItem value="hierarchy">
              <AccordionTrigger>2. Hierarchy & Navigation</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center">
                    <Label>Parent Table</Label>
                    <InfoTooltip text="Select the parent form if this is a child/repeat form. Leave as 'None' for top-level forms. Setting this makes isbase=0 and requireslink=1 automatically." />
                  </div>
                  <Select
                    value={normalizedParentTable || '_none_'}
                    onValueChange={(v) => {
                      const newParent = v === '_none_' ? undefined : v;
                      update('parenttable', newParent);
                      // Auto-set linking field if parent is selected
                      if (newParent && !editedForm.linkingfield) {
                        // Try to find a common linking field
                        const parentForm = otherForms.find(f => f.tablename === newParent);
                        if (parentForm?.primaryKey) {
                          update('linkingfield', parentForm.primaryKey.split(',')[0].trim());
                        }
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None (top-level form)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_">None (top-level form, isbase=1)</SelectItem>
                      {otherForms.map(f => (
                        <SelectItem key={f.id} value={f.tablename}>
                          {f.displayname} ({f.tablename})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {isChildForm
                      ? "Child form: isbase=0, requireslink=1"
                      : "Top-level form: isbase=1, requireslink=0"}
                  </p>
                </div>

                {isChildForm && (
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label>Linking Field</Label>
                      <InfoTooltip text="Field in this form that links to the parent record. Usually the parent's primary key (e.g., hhid)." />
                    </div>
                    <Select
                      value={editedForm.linkingfield || '_none_'}
                      onValueChange={(v) => update('linkingfield', v === '_none_' ? undefined : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select field..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none_">Not set</SelectItem>
                        {availableFields.map(q => (
                          <SelectItem key={q.fieldname} value={q.fieldname}>
                            {q.fieldname}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* entry_condition applies to base forms too -- manifest.ts
                    emits it unconditionally (the real SurveyGen sample
                    carries it on a base CRF), so this is no longer gated
                    to child forms only. */}
                <div className="space-y-2">
                  <div className="flex items-center">
                    <Label>Entry Condition</Label>
                    <InfoTooltip text="Logic expression that determines when this form should be available. The form only appears when this condition is true (e.g., 'enrolled=1')." />
                  </div>
                  <Input
                    value={editedForm.entry_condition || ''}
                    onChange={(e) => update('entry_condition', e.target.value || undefined)}
                    placeholder="e.g., enrolled=1"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* 3. ID Generation */}
            <AccordionItem value="idconfig">
              <AccordionTrigger>3. ID Generation</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <FieldSelector
                  label="Primary Key"
                  tooltip="Field(s) that uniquely identify a record. For child forms, typically includes the linking field plus an increment field (e.g., hhid,linenum)."
                  availableFields={availableFields}
                  selectedFields={parseFieldList(editedForm.primaryKey)}
                  onChange={(fields) => update('primaryKey', formatFieldList(fields))}
                />

                {/* manifest.ts emits idconfig unconditionally for any form,
                    not just base forms -- a repeating child form can have
                    its own generated ID sequence independent of its
                    parent's, so this is no longer gated to base forms only. */}
                <div className="flex items-center gap-2 pt-2">
                  <Checkbox
                    id="enableIdConfig"
                    checked={!!editedForm.idconfig}
                    onCheckedChange={handleIdConfigToggle}
                  />
                  <Label htmlFor="enableIdConfig" className="cursor-pointer">
                    Enable automatic ID generation
                  </Label>
                  <InfoTooltip text="Generate unique IDs by combining a prefix, field values, and an auto-incrementing number." />
                </div>

                {editedForm.idconfig && (
                  <div className="space-y-4 pl-6 border-l-2 border-muted">
                        <div className="space-y-2">
                          <div className="flex items-center">
                            <Label>ID Prefix</Label>
                            <InfoTooltip text="Static string prepended to all generated IDs (e.g., 'GL', '3')." />
                          </div>
                          <Input
                            value={editedForm.idconfig.prefix}
                            onChange={(e) => updateIdConfig({ prefix: e.target.value })}
                            placeholder="e.g., GL"
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <Label>Component Fields</Label>
                              <InfoTooltip text="Survey fields that compose the ID. Each field's value is padded to the specified length with leading zeros." />
                            </div>
                            <Button variant="outline" size="sm" onClick={addIdField}>
                              <Plus className="h-4 w-4 mr-1" />
                              Add Field
                            </Button>
                          </div>

                          {editedForm.idconfig.fields.map((field, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <Select
                                value={field.name || '_select_'}
                                onValueChange={(v) => updateIdField(index, 'name', v === '_select_' ? '' : v)}
                              >
                                <SelectTrigger className="flex-1">
                                  <SelectValue placeholder="Select field" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="_select_">Select field...</SelectItem>
                                  {availableFields.map(q => (
                                    <SelectItem key={q.fieldname} value={q.fieldname}>
                                      {q.fieldname}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <div className="flex items-center gap-1">
                                <Label className="text-xs whitespace-nowrap">Length:</Label>
                                <Input
                                  type="number"
                                  value={field.length}
                                  onChange={(e) => updateIdField(index, 'length', parseInt(e.target.value) || 1)}
                                  className="w-16"
                                  min={1}
                                />
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeIdField(index)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center">
                            <Label>Increment Length</Label>
                            <InfoTooltip text="Number of digits for the auto-increment portion (e.g., 3 = 001, 002...). Set to 0 if no increment is needed." />
                          </div>
                          <Input
                            type="number"
                            value={editedForm.idconfig.incrementLength}
                            onChange={(e) => updateIdConfig({ incrementLength: parseInt(e.target.value) || 0 })}
                            className="w-24"
                            min={0}
                          />
                        </div>

                        {/* Preview */}
                        <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                          <strong>Example ID:</strong>{' '}
                          {editedForm.idconfig.prefix}
                          {editedForm.idconfig.fields.map(f => '0'.repeat(f.length)).join('')}
                          {editedForm.idconfig.incrementLength > 0 && '0'.repeat(editedForm.idconfig.incrementLength)}
                        </div>
                      </div>
                    )}

                {/* Increment Field - only for child forms */}
                {isChildForm && (
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label>Increment Field</Label>
                      <InfoTooltip text="Field that auto-increments for each child record (e.g., linenum for household members). This creates sequential numbers: 1, 2, 3..." />
                    </div>
                    <Select
                      value={editedForm.incrementField || '_none_'}
                      onValueChange={(v) => update('incrementField', v === '_none_' ? undefined : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select field..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none_">Not set</SelectItem>
                        {availableFields.map(q => (
                          <SelectItem key={q.fieldname} value={q.fieldname}>
                            {q.fieldname}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* 4. Auto-Repeat Logic - only for child forms */}
            {isChildForm && (
              <AccordionItem value="repeat">
                <AccordionTrigger>4. Auto-Repeat Logic</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label>Repeat Count Field</Label>
                      <InfoTooltip text="Field in the PARENT form that contains the expected number of child records. This is used to know how many repeats are expected." />
                    </div>
                    <Select
                      value={editedForm.repeatCountField || '_none_'}
                      onValueChange={(v) => update('repeatCountField', v === '_none_' ? undefined : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select field from parent..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none_">Not set</SelectItem>
                        {/* Show fields from parent form */}
                        {otherForms
                          .find(f => f.tablename === editedForm.parenttable)
                          ?.questions.map(q => (
                            <SelectItem key={q.fieldname} value={q.fieldname}>
                              {q.fieldname} {q.text ? `- ${q.text.substring(0, 25)}...` : ''}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label>Auto-Start Behavior</Label>
                      <InfoTooltip text="Controls how the child form is initiated when the parent form flow dictates." />
                    </div>
                    <Select
                      value={String(editedForm.autoStartRepeat)}
                      onValueChange={(v) => update('autoStartRepeat', parseInt(v) as 0 | 1 | 2)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">
                          <div className="flex flex-col">
                            <span>0 - Disabled</span>
                            <span className="text-xs text-muted-foreground">User manually adds records</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="1">
                          <div className="flex flex-col">
                            <span>1 - Prompt (Recommended)</span>
                            <span className="text-xs text-muted-foreground">System prompts "Add a record now?"</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="2">
                          <div className="flex flex-col">
                            <span>2 - Force</span>
                            <span className="text-xs text-muted-foreground">Automatically starts without asking</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label>Enforce Count</Label>
                      <InfoTooltip text="How the app handles mismatches between expected and actual number of child records." />
                    </div>
                    <Select
                      value={String(editedForm.repeatEnforceCount)}
                      onValueChange={(v) => update('repeatEnforceCount', parseInt(v) as 0 | 1 | 2 | 3)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">
                          <div className="flex flex-col">
                            <span>0 - Flexible</span>
                            <span className="text-xs text-muted-foreground">No validation on count</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="1">
                          <div className="flex flex-col">
                            <span>1 - Warn (Recommended)</span>
                            <span className="text-xs text-muted-foreground">Shows warning if count mismatch</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="2">
                          <div className="flex flex-col">
                            <span>2 - Force</span>
                            <span className="text-xs text-muted-foreground">Blocks until exact count is met</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="3">
                          <div className="flex flex-col">
                            <span>3 - Auto-sync</span>
                            <span className="text-xs text-muted-foreground">Updates parent count automatically</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </ScrollArea>

        <SheetFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Configuration
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default FormManifestEditor;
