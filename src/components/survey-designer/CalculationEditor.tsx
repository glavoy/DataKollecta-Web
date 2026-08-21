import {
  CalculationConfig,
  SurveyQuestion,
  constantOf,
  constantText,
  isConstant,
} from "@/types/survey";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface CalculationEditorProps {
  calculation: CalculationConfig | undefined;
  availableFields: SurveyQuestion[];
  onChange: (calc: CalculationConfig | undefined) => void;
}

/** '[[startdate]]' -> 'startdate'; a literal date or nothing -> ''. */
const refDateOf = (separator: string | undefined): string => {
  const m = /^\[\[(\w+)\]\]$/.exec(separator?.trim() ?? '');
  return m ? m[1] : '';
};

const isFixedDate = (separator: string | undefined): boolean =>
  Boolean(separator) && refDateOf(separator) === '';

/** The app matches these words exactly; anything else computes nothing. */
const ageUnitOf = (value: string | undefined): string =>
  value === 'months' || value === 'days' ? value : 'years';

const CalculationEditor = ({ calculation, availableFields, onChange }: CalculationEditorProps) => {
  const dateFields = availableFields.filter(q =>
    q.fieldtype === 'date' || q.fieldtype === 'datetime'
  );

  /**
   * Defaults baked into real state the moment a type is chosen -- not just
   * displayed as a Select's fallback label. A Select bound to
   * `calculation.unit || 'yyyy'` LOOKS pre-set to the sensible default, but if
   * the user's choice already matches that label they never trigger
   * onValueChange, so the underlying value stays undefined. For most types the
   * app falls back sensibly at read time too, so this was invisible; for
   * date_part there is no such fallback (auto_fields.dart returns '' for an
   * unrecognized/absent unit), so an untouched dropdown silently shipped a
   * calculation that always computes to nothing. Found by hand-building a
   * survey with the designer and inspecting the generated XML.
   */
  const handleTypeChange = (type: CalculationConfig['type']) => {
    const defaults: Partial<Record<CalculationConfig['type'], CalculationConfig>> = {
      age_at_date: { type, value: 'years' },
      age_from_date: { type, unit: 'y' },
      date_diff: { type, unit: 'd' },
      date_part: { type, unit: 'yyyy' },
      math: { type, operator: '+' },
    };
    onChange(defaults[type] ?? { type });
  };

  const addCase = () => {
    if (!calculation) return;
    const cases = calculation.cases || [];
    onChange({
      ...calculation,
      cases: [
        ...cases,
        {
          id: `case-${Date.now()}-${cases.length}`,
          field: '',
          operator: '=',
          value: '',
          result: constantOf(''),
        },
      ],
    });
  };

  const updateCase = (index: number, field: 'field' | 'operator' | 'value', value: string) => {
    if (!calculation?.cases) return;
    const newCases = [...calculation.cases];
    newCases[index] = { ...newCases[index], [field]: value };
    onChange({ ...calculation, cases: newCases });
  };

  /**
   * A case result is a full calculation -- the app has always supported a
   * nested one. This editor only authors constants; anything richer arrives
   * from an imported package and is shown read-only rather than flattened.
   */
  const updateCaseResult = (index: number, value: string) => {
    if (!calculation?.cases) return;
    const newCases = [...calculation.cases];
    newCases[index] = { ...newCases[index], result: constantOf(value) };
    onChange({ ...calculation, cases: newCases });
  };

  const removeCase = (index: number) => {
    if (!calculation?.cases) return;
    onChange({
      ...calculation,
      cases: calculation.cases.filter((_, i) => i !== index)
    });
  };

  // math/concat operands. The app evaluates these from <part> children; there
  // is no expression parser, so a free-text "a + b" would compute nothing.
  const parts = calculation?.parts ?? [];

  const setParts = (next: CalculationConfig[]) => {
    if (!calculation) return;
    onChange({ ...calculation, parts: next });
  };

  const addPart = () => setParts([...parts, constantOf('')]);

  const removePart = (index: number) => setParts(parts.filter((_, i) => i !== index));

  const updatePart = (index: number, next: CalculationConfig) =>
    setParts(parts.map((p, i) => (i === index ? next : p)));

  /**
   * One row per operand: a field reference or a literal. Nested math/concat
   * parts round-trip from imported packages but are shown read-only here.
   */
  const renderParts = (label: string, hint: string) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button variant="outline" size="sm" onClick={addPart}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>

      {parts.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No operands yet — this calculation will produce nothing until you add at least one.
        </p>
      )}

      {parts.map((part, index) => {
        const editable = part.type === 'constant' || part.type === 'lookup';
        return (
          <div key={index} className="flex items-center gap-2">
            <Select
              value={editable ? part.type : 'nested'}
              onValueChange={(v) =>
                updatePart(index, v === 'lookup' ? { type: 'lookup', field: '' } : constantOf(''))
              }
              disabled={!editable}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lookup">Field</SelectItem>
                <SelectItem value="constant">Value</SelectItem>
                {!editable && <SelectItem value="nested">{part.type}</SelectItem>}
              </SelectContent>
            </Select>

            {part.type === 'lookup' ? (
              <Select
                value={part.field || ''}
                onValueChange={(v) => updatePart(index, { type: 'lookup', field: v })}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  {availableFields.map((f) => (
                    <SelectItem key={f.fieldname} value={f.fieldname}>
                      {f.fieldname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                className="flex-1"
                placeholder={editable ? 'Literal value' : 'Nested calculation'}
                value={constantText(part)}
                onChange={(e) => updatePart(index, constantOf(e.target.value))}
                disabled={!editable}
              />
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={() => removePart(index)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  // Query params helpers
  const addQueryParam = () => {
    if (!calculation) return;
    const params = calculation.params || [];
    onChange({
      ...calculation,
      params: [...params, { name: '', field: '' }]
    });
  };

  const updateQueryParam = (index: number, key: 'name' | 'field', value: string) => {
    if (!calculation?.params) return;
    const newParams = [...calculation.params];
    newParams[index] = { ...newParams[index], [key]: value };
    onChange({ ...calculation, params: newParams });
  };

  const removeQueryParam = (index: number) => {
    if (!calculation?.params) return;
    onChange({
      ...calculation,
      params: calculation.params.filter((_, i) => i !== index)
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Calculation Type</Label>
        <Select
          value={calculation?.type || ''}
          onValueChange={(v) => handleTypeChange(v as CalculationConfig['type'])}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select calculation type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="age_from_date">Age from Date (today)</SelectItem>
            <SelectItem value="age_at_date">Age at Specific Date</SelectItem>
            <SelectItem value="date_diff">Date Difference</SelectItem>
            <SelectItem value="date_offset">Date Offset</SelectItem>
            <SelectItem value="date_part">Date Part (Extract)</SelectItem>
            <SelectItem value="case">Conditional (If/Else)</SelectItem>
            <SelectItem value="concat">Concatenate</SelectItem>
            <SelectItem value="math">Math Expression</SelectItem>
            <SelectItem value="constant">Constant Value</SelectItem>
            <SelectItem value="lookup">Lookup (Copy from Field)</SelectItem>
            <SelectItem value="query">SQL Query</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Age from Date - calculate age from a date field to today */}
      {calculation?.type === 'age_from_date' && (
        <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
          <div className="space-y-2">
            <Label>Date of Birth Field</Label>
            <Select
              value={calculation.field || ''}
              onValueChange={(v) => onChange({ ...calculation, field: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select date field" />
              </SelectTrigger>
              <SelectContent>
                {dateFields.map(q => (
                  <SelectItem key={q.id} value={q.fieldname}>{q.fieldname}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Result Unit</Label>
            <Select
              value={calculation.unit || 'y'}
              onValueChange={(v) => onChange({ ...calculation, unit: v as 'y' | 'm' | 'w' | 'd' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="y">Years</SelectItem>
                <SelectItem value="m">Months</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Age at Date - calculate age at a specific date */}
      {calculation?.type === 'age_at_date' && (
        <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Date of Birth Field</Label>
              <Select
                value={calculation.field || ''}
                onValueChange={(v) => onChange({ ...calculation, field: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  {dateFields.map(q => (
                    <SelectItem key={q.id} value={q.fieldname}>{q.fieldname}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Age At (Reference Date)</Label>
              {/* The app reads the reference date from `separator`, wrapped as
                  [[field]] -- not from `value`, which carries the unit. */}
              <Select
                value={refDateOf(calculation.separator)}
                onValueChange={(v) => onChange({ ...calculation, separator: `[[${v}]]` })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  {dateFields.map(q => (
                    <SelectItem key={q.id} value={q.fieldname}>{q.fieldname}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Fixed Date Instead (optional)</Label>
            <Input
              value={isFixedDate(calculation.separator) ? calculation.separator ?? '' : ''}
              onChange={(e) =>
                onChange({ ...calculation, separator: e.target.value || undefined })
              }
              placeholder="e.g., 2025-03-31 — overrides the field above"
            />
          </div>
          <div className="space-y-2">
            <Label>Result Unit</Label>
            <Select
              value={ageUnitOf(calculation.value)}
              onValueChange={(v) => onChange({ ...calculation, value: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* These exact words are what the app matches on. */}
                <SelectItem value="years">Years</SelectItem>
                <SelectItem value="months">Months</SelectItem>
                <SelectItem value="days">Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Date Difference */}
      {calculation?.type === 'date_diff' && (
        <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Start Date Field</Label>
              <Select
                value={calculation.field || ''}
                onValueChange={(v) => onChange({ ...calculation, field: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  {dateFields.map(q => (
                    <SelectItem key={q.id} value={q.fieldname}>{q.fieldname}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>End Date Field</Label>
              <Select
                value={calculation.value || ''}
                onValueChange={(v) => onChange({ ...calculation, value: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  {dateFields.map(q => (
                    <SelectItem key={q.id} value={q.fieldname}>{q.fieldname}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Result Unit</Label>
            <Select
              value={calculation.unit || 'd'}
              onValueChange={(v) => onChange({ ...calculation, unit: v as 'y' | 'm' | 'w' | 'd' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="y">Years</SelectItem>
                <SelectItem value="m">Months</SelectItem>
                <SelectItem value="w">Weeks</SelectItem>
                <SelectItem value="d">Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Date Part - extract one component from a date field */}
      {calculation?.type === 'date_part' && (
        <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
          <div className="space-y-2">
            <Label>Source Date Field</Label>
            <Select
              value={calculation.field || ''}
              onValueChange={(v) => onChange({ ...calculation, field: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select date field" />
              </SelectTrigger>
              <SelectContent>
                {dateFields.map((q) => (
                  <SelectItem key={q.id} value={q.fieldname}>{q.fieldname}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Part to Extract</Label>
            <Select
              value={calculation.unit || 'yyyy'}
              onValueChange={(v) =>
                onChange({ ...calculation, unit: v as CalculationConfig['unit'] })
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yyyy">Year (4-digit)</SelectItem>
                <SelectItem value="yy">Year (2-digit)</SelectItem>
                <SelectItem value="mm">Month</SelectItem>
                <SelectItem value="dd">Day of month</SelectItem>
                <SelectItem value="doy">Day of year</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Recomputes whenever the source date changes. For today's date instead, add a
            question named yyyy, yy, mm, dd or doy — those are set once and never change.
          </p>
        </div>
      )}

      {/* Date Offset - add/subtract from a date */}
      {calculation?.type === 'date_offset' && (
        <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
          <div className="space-y-2">
            <Label>Source Date Field</Label>
            <Select
              value={calculation.field || ''}
              onValueChange={(v) => onChange({ ...calculation, field: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select date field" />
              </SelectTrigger>
              <SelectContent>
                {dateFields.map(q => (
                  <SelectItem key={q.id} value={q.fieldname}>{q.fieldname}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Offset Value</Label>
            <Input
              value={calculation.value || ''}
              onChange={(e) => onChange({ ...calculation, value: e.target.value })}
              placeholder="e.g., +7d, -1m, +1y (or field name)"
            />
            <p className="text-xs text-muted-foreground">
              Use +/- with d (days), w (weeks), m (months), y (years). Or a field name.
            </p>
          </div>
        </div>
      )}

      {/* Constant */}
      {calculation?.type === 'constant' && (
        <div className="space-y-2 p-4 rounded-lg bg-muted/30 border border-border">
          <Label>Constant Value</Label>
          <Input
            value={calculation.value || ''}
            onChange={(e) => onChange({ ...calculation, value: e.target.value })}
            placeholder="Enter constant value"
          />
        </div>
      )}

      {/* Lookup - copy from another field */}
      {calculation?.type === 'lookup' && (
        <div className="space-y-2 p-4 rounded-lg bg-muted/30 border border-border">
          <Label>Source Field</Label>
          <Select
            value={calculation.field || ''}
            onValueChange={(v) => onChange({ ...calculation, field: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select field to copy from" />
            </SelectTrigger>
            <SelectContent>
              {availableFields.map(q => (
                <SelectItem key={q.id} value={q.fieldname}>{q.fieldname}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Value will be copied from the selected field
          </p>
        </div>
      )}

      {/* Conditional (Case) */}
      {calculation?.type === 'case' && (
        <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center justify-between">
            <Label>Conditions</Label>
            <Button variant="outline" size="sm" onClick={addCase}>
              <Plus className="h-4 w-4 mr-1" />
              Add Condition
            </Button>
          </div>

          <div className="space-y-2">
            {calculation.cases?.map((c, index) => (
              <div key={index} className="p-3 border border-border rounded-lg bg-background space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm">When</span>
                  <Select
                    value={c.field}
                    onValueChange={(v) => updateCase(index, 'field', v)}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="Field" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFields.map(q => (
                        <SelectItem key={q.id} value={q.fieldname}>{q.fieldname}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={c.operator}
                    onValueChange={(v) => updateCase(index, 'operator', v)}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="=">=</SelectItem>
                      <SelectItem value="<>">!=</SelectItem>
                      <SelectItem value="<">&lt;</SelectItem>
                      <SelectItem value=">">&gt;</SelectItem>
                      <SelectItem value="<=">&lt;=</SelectItem>
                      <SelectItem value=">=">&gt;=</SelectItem>
                    </SelectContent>
                  </Select>

                  <Input
                    placeholder="Value"
                    value={c.value}
                    onChange={(e) => updateCase(index, 'value', e.target.value)}
                    className="w-24"
                  />

                  <span className="text-sm">then</span>

                  <Input
                    placeholder={isConstant(c.result) ? 'Result' : c.result?.type}
                    value={constantText(c.result)}
                    onChange={(e) => updateCaseResult(index, e.target.value)}
                    disabled={!isConstant(c.result)}
                    title={
                      isConstant(c.result)
                        ? undefined
                        : `This branch returns a ${c.result?.type} calculation, which this editor cannot yet edit.`
                    }
                    className="w-24"
                  />

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCase(index)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Else (default) Result</Label>
            <Input
              value={constantText(calculation.defaultResult)}
              onChange={(e) =>
                onChange({ ...calculation, defaultResult: constantOf(e.target.value) })
              }
              disabled={
                calculation.defaultResult !== undefined && !isConstant(calculation.defaultResult)
              }
              placeholder="Default value if no conditions match"
            />
          </div>
        </div>
      )}

      {/* Math Expression */}
      {calculation?.type === 'math' && (
        <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
          <div className="space-y-2">
            <Label>Operator</Label>
            <Select
              value={calculation.operator || '+'}
              onValueChange={(v) =>
                onChange({ ...calculation, operator: v as CalculationConfig['operator'] })
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="+">+ Add</SelectItem>
                <SelectItem value="-">− Subtract</SelectItem>
                <SelectItem value="*">× Multiply</SelectItem>
                <SelectItem value="/">÷ Divide</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {renderParts('Operands', 'Applied left to right, in order.')}
        </div>
      )}

      {/* Concatenate */}
      {calculation?.type === 'concat' && (
        <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
          {renderParts('Pieces', 'Joined in order.')}
          <div className="space-y-2">
            <Label className="text-sm">Separator (optional)</Label>
            <Input
              value={calculation.separator || ''}
              onChange={(e) => onChange({ ...calculation, separator: e.target.value })}
              placeholder="e.g., - or space"
            />
          </div>
        </div>
      )}

      {/* SQL Query */}
      {calculation?.type === 'query' && (
        <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
          <div className="space-y-2">
            <Label>SQL Query</Label>
            <Textarea
              value={calculation.sql || ''}
              onChange={(e) => onChange({ ...calculation, sql: e.target.value })}
              placeholder="SELECT column FROM table WHERE id = :param1"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Use :paramName for parameters that will be populated from fields
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Query Parameters</Label>
              <Button variant="outline" size="sm" onClick={addQueryParam}>
                <Plus className="h-4 w-4 mr-1" />
                Add Parameter
              </Button>
            </div>

            {(calculation.params || []).map((param, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  placeholder="Param name (e.g., param1)"
                  value={param.name}
                  onChange={(e) => updateQueryParam(index, 'name', e.target.value)}
                  className="w-36"
                />
                <span className="text-sm">=</span>
                <Select
                  value={param.field}
                  onValueChange={(v) => updateQueryParam(index, 'field', v)}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select field" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableFields.map(q => (
                      <SelectItem key={q.id} value={q.fieldname}>{q.fieldname}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeQueryParam(index)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            {(!calculation.params || calculation.params.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-2">
                No parameters configured.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CalculationEditor;
