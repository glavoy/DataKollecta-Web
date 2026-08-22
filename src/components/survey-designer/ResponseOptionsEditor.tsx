import { useMemo, useState } from "react";
import { ResponseOption, DynamicResponseConfig, CsvFile } from "@/types/survey";
import { parseCsvHeaderRow } from "@/lib/csvHeaders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, GripVertical, Database, List } from "lucide-react";
import { Separator } from "@/components/ui/separator";
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
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ResponseOptionsEditorProps {
  responses: ResponseOption[];
  dynamicResponses?: DynamicResponseConfig;
  /** The question's resolved mode (mirrors resolvedResponseMode from
   *  lib/xml/question.ts) -- used only to pick the initially-open tab, so a
   *  question already carrying both blocks (e.g. one saved by this bug
   *  before it was fixed) opens on the tab that actually gets emitted,
   *  rather than whichever block merely happens to be present. */
  resolvedMode: 'static' | 'dynamic';
  onChange: (responses: ResponseOption[]) => void;
  onDynamicChange: (config: DynamicResponseConfig | undefined) => void;
  /** Which block actually gets emitted -- must track the active tab, or the
   *  emitter (which trusts this over the *presence* of dynamicResponses)
   *  keeps exporting the old static list after switching to Dynamic. */
  onResponseModeChange: (mode: 'static' | 'dynamic') => void;
  /** The survey's uploaded CSV files. When present, the CSV file and its
   *  display/value columns become pickers instead of free text. */
  csvFiles?: CsvFile[];
}

/** A <Select> of `options`, falling back to a free-text <Input> when there's
 *  nothing to pick from -- an unselected file, or a file with no parsable
 *  header row. If the current value isn't among the options (a column
 *  renamed upstream, a hand-edited package), it's kept as a selectable
 *  entry rather than silently disappearing from the field. */
const PickerOrInput = ({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  className?: string;
}) => {
  if (options.length === 0) {
    return (
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={className} />
    );
  }
  const items = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item} value={item}>{item}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

interface ResponseRowProps {
  response: ResponseOption;
  index: number;
  onUpdate: (id: string, field: 'value' | 'label', newValue: string) => void;
  onRemove: (id: string) => void;
}

/** The grip used to render but had no listeners at all -- it looked
 *  draggable and did nothing. Wired up with the same @dnd-kit pattern
 *  already proven for question reordering in SurveyDesigner/QuestionCard. */
const ResponseRow = ({ response, index, onUpdate, onRemove }: ResponseRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: response.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing touch-none">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>
      <span className="text-sm text-muted-foreground w-6">{index + 1}.</span>
      <Input
        placeholder="Value (stored)"
        value={response.value}
        onChange={(e) => onUpdate(response.id, 'value', e.target.value)}
        className="w-24"
      />
      <Input
        placeholder="Label (displayed)"
        value={response.label}
        onChange={(e) => onUpdate(response.id, 'label', e.target.value)}
        className="flex-1"
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onRemove(response.id)}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
};

const ResponseOptionsEditor = ({
  responses,
  dynamicResponses,
  resolvedMode,
  onChange,
  onDynamicChange,
  onResponseModeChange,
  csvFiles,
}: ResponseOptionsEditorProps) => {
  const [activeTab, setActiveTab] = useState<string>(resolvedMode);

  const csvFilenames = useMemo(() => (csvFiles ?? []).map((f) => f.filename), [csvFiles]);
  const selectedCsvHeaders = useMemo(() => {
    if (dynamicResponses?.source !== 'csv' || !dynamicResponses.file) return [];
    const file = (csvFiles ?? []).find((f) => f.filename === dynamicResponses.file);
    return file ? parseCsvHeaderRow(file.content) : [];
  }, [csvFiles, dynamicResponses?.source, dynamicResponses?.file]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleResponseDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = responses.findIndex(r => r.id === active.id);
    const newIndex = responses.findIndex(r => r.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(arrayMove(responses, oldIndex, newIndex));
  };

  const addResponse = () => {
    onChange([
      ...responses,
      { id: crypto.randomUUID(), value: String(responses.length + 1), label: '' }
    ]);
  };

  const updateResponse = (id: string, field: 'value' | 'label', newValue: string) => {
    onChange(
      responses.map(r =>
        r.id === id ? { ...r, [field]: newValue } : r
      )
    );
  };

  const removeResponse = (id: string) => {
    onChange(responses.filter(r => r.id !== id));
  };

  const initDynamicConfig = () => {
    onDynamicChange({
      source: 'csv',
      file: '',
      displayColumn: '',
      valueColumn: '',
      filters: [],
    });
  };

  const updateDynamic = <K extends keyof DynamicResponseConfig>(
    field: K,
    value: DynamicResponseConfig[K]
  ) => {
    if (!dynamicResponses) return;
    onDynamicChange({ ...dynamicResponses, [field]: value });
  };

  const addFilter = () => {
    if (!dynamicResponses) return;
    onDynamicChange({
      ...dynamicResponses,
      filters: [...dynamicResponses.filters, { column: '', operator: '=', value: '' }]
    });
  };

  const updateFilter = (index: number, field: string, value: string) => {
    if (!dynamicResponses) return;
    const filters = [...dynamicResponses.filters];
    filters[index] = { ...filters[index], [field]: value };
    onDynamicChange({ ...dynamicResponses, filters });
  };

  const removeFilter = (index: number) => {
    if (!dynamicResponses) return;
    onDynamicChange({
      ...dynamicResponses,
      filters: dynamicResponses.filters.filter((_, i) => i !== index)
    });
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'dynamic') {
      onResponseModeChange('dynamic');
      if (!dynamicResponses) initDynamicConfig();
    } else if (tab === 'static') {
      onResponseModeChange('static');
      onDynamicChange(undefined);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="static" className="flex items-center gap-2">
            <List className="h-4 w-4" />
            Static Options
          </TabsTrigger>
          <TabsTrigger value="dynamic" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Dynamic (CSV/DB)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="static" className="space-y-3 mt-4">
          <div className="flex items-center justify-between">
            <Label>Response Options</Label>
            <Button variant="outline" size="sm" onClick={addResponse}>
              <Plus className="h-4 w-4 mr-1" />
              Add Option
            </Button>
          </div>

          <div className="space-y-2">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleResponseDragEnd}>
              <SortableContext items={responses.map(r => r.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {responses.map((response, index) => (
                    <ResponseRow
                      key={response.id}
                      response={response}
                      index={index}
                      onUpdate={updateResponse}
                      onRemove={removeResponse}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {responses.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No response options. Click "Add Option" to create choices.
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="dynamic" className="space-y-4 mt-4">
          {dynamicResponses && (
            <>
              {/* Source Type */}
              <div className="space-y-2">
                <Label>Data Source</Label>
                <Select
                  value={dynamicResponses.source}
                  onValueChange={(v) => updateDynamic('source', v as 'csv' | 'database')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV File</SelectItem>
                    <SelectItem value="database">Database Table</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* File or Table */}
              {dynamicResponses.source === 'csv' ? (
                <div className="space-y-2">
                  <Label>CSV File Name</Label>
                  <PickerOrInput
                    value={dynamicResponses.file || ''}
                    onChange={(v) => updateDynamic('file', v)}
                    options={csvFilenames}
                    placeholder="e.g., locations.csv"
                  />
                  <p className="text-xs text-muted-foreground">
                    {csvFilenames.length > 0
                      ? 'Selected from the files uploaded in Survey Settings'
                      : 'CSV file must be included in the survey package'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Table Name</Label>
                  <Input
                    value={dynamicResponses.table || ''}
                    onChange={(e) => updateDynamic('table', e.target.value)}
                    placeholder="e.g., households"
                  />
                </div>
              )}

              {/* Display and Value Columns */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Display Column</Label>
                  <PickerOrInput
                    value={dynamicResponses.displayColumn}
                    onChange={(v) => updateDynamic('displayColumn', v)}
                    options={selectedCsvHeaders}
                    placeholder="e.g., name"
                  />
                  <p className="text-xs text-muted-foreground">
                    Column shown to user
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Value Column</Label>
                  <PickerOrInput
                    value={dynamicResponses.valueColumn}
                    onChange={(v) => updateDynamic('valueColumn', v)}
                    options={selectedCsvHeaders}
                    placeholder="e.g., id"
                  />
                  <p className="text-xs text-muted-foreground">
                    Column stored as value
                  </p>
                </div>
              </div>

              <Separator />

              {/* Filters */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Filters</Label>
                    <p className="text-xs text-muted-foreground">
                      Filter results based on other fields or values
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={addFilter}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Filter
                  </Button>
                </div>

                {dynamicResponses.filters.map((filter, index) => (
                  <div key={index} className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border">
                    <PickerOrInput
                      value={filter.column}
                      onChange={(v) => updateFilter(index, 'column', v)}
                      options={selectedCsvHeaders}
                      placeholder="Column"
                      className="w-28"
                    />
                    <Select
                      value={filter.operator}
                      onValueChange={(v) => updateFilter(index, 'operator', v)}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="=">=</SelectItem>
                        <SelectItem value="<>">!=</SelectItem>
                        <SelectItem value="like">like</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Value or [[field]]"
                      value={filter.value}
                      onChange={(e) => updateFilter(index, 'value', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFilter(index)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                {dynamicResponses.filters.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    No filters configured. Add filters to narrow down results.
                  </p>
                )}
              </div>

              <Separator />

              {/* Additional Options */}
              <div className="space-y-4">
                <Label className="font-medium">Additional Options</Label>

                <div className="space-y-2">
                  <Label className="text-xs">Empty Message</Label>
                  <Input
                    value={dynamicResponses.emptyMessage || ''}
                    onChange={(e) => updateDynamic('emptyMessage', e.target.value || undefined)}
                    placeholder="Message when no results found"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Don't Know Option</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Value"
                        value={dynamicResponses.dontKnow?.value || ''}
                        onChange={(e) => updateDynamic('dontKnow', e.target.value
                          ? { value: e.target.value, label: dynamicResponses.dontKnow?.label || "Don't Know" }
                          : undefined
                        )}
                        className="w-20"
                      />
                      <Input
                        placeholder="Label"
                        value={dynamicResponses.dontKnow?.label || ''}
                        onChange={(e) => {
                          if (dynamicResponses.dontKnow?.value) {
                            updateDynamic('dontKnow', { ...dynamicResponses.dontKnow, label: e.target.value });
                          }
                        }}
                        className="flex-1"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Not in List Option</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Value"
                        value={dynamicResponses.notInList?.value || ''}
                        onChange={(e) => updateDynamic('notInList', e.target.value
                          ? { value: e.target.value, label: dynamicResponses.notInList?.label || 'Not in list' }
                          : undefined
                        )}
                        className="w-20"
                      />
                      <Input
                        placeholder="Label"
                        value={dynamicResponses.notInList?.label || ''}
                        onChange={(e) => {
                          if (dynamicResponses.notInList?.value) {
                            updateDynamic('notInList', { ...dynamicResponses.notInList, label: e.target.value });
                          }
                        }}
                        className="flex-1"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ResponseOptionsEditor;
