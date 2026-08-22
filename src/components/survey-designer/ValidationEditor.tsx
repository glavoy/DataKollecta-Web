import { NumericCheck, DateRange, LogicCheck, QuestionType, FieldType } from "@/types/survey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2 } from "lucide-react";

interface ValidationEditorProps {
  questionType: QuestionType;
  fieldtype: FieldType;
  numericCheck?: NumericCheck;
  dateRange?: DateRange;
  logicCheck?: LogicCheck[];
  uniqueCheck?: { message: string };
  onNumericCheckChange: (check: NumericCheck | undefined) => void;
  onDateRangeChange: (range: DateRange | undefined) => void;
  onLogicCheckChange: (check: LogicCheck[] | undefined) => void;
  onUniqueCheckChange: (check: { message: string } | undefined) => void;
}

const ValidationEditor = ({
  questionType,
  fieldtype,
  numericCheck,
  dateRange,
  logicCheck,
  uniqueCheck,
  onNumericCheckChange,
  onDateRangeChange,
  onLogicCheckChange,
  onUniqueCheckChange,
}: ValidationEditorProps) => {
  const showNumeric = ['text_integer', 'text_decimal'].includes(fieldtype) && questionType === 'text';
  const showDate = ['date', 'datetime'].includes(fieldtype);
  const showLogic = questionType !== 'information';
  // survey_screen.dart's uniqueness check runs in _next() for whichever
  // question is currently displayed, keyed only by fieldname -- unlike
  // numericCheck/mask/maxCharacters (all gated behind `q.type == text`
  // deep inside _buildText's formatters), it reads _answers[fieldName]
  // generically, so it works for radio/checkbox/combobox/date/datetime
  // too. Only information (no stored answer) and calculated (never
  // interactively displayed) are truly inert.
  const showUnique = questionType !== 'information' && questionType !== 'calculated';

  // Logic check helpers
  const addLogicCheck = () => {
    const newCheck: LogicCheck = { condition: '', message: 'Validation failed' };
    onLogicCheckChange([...(logicCheck || []), newCheck]);
  };

  const updateLogicCheck = (index: number, field: keyof LogicCheck, value: string) => {
    if (!logicCheck) return;
    const updated = [...logicCheck];
    updated[index] = { ...updated[index], [field]: value };
    onLogicCheckChange(updated);
  };

  const removeLogicCheck = (index: number) => {
    if (!logicCheck) return;
    onLogicCheckChange(logicCheck.filter((_, i) => i !== index));
  };

  // Check if there are any validation options available
  const hasAnyOptions = showNumeric || showDate || showLogic || showUnique;

  if (!hasAnyOptions) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No validation options available for this question type.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Numeric Validation */}
      {showNumeric && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="enableNumeric"
              checked={!!numericCheck}
              onCheckedChange={(checked) => {
                if (checked) {
                  onNumericCheckChange({ message: 'Value is out of range' });
                } else {
                  onNumericCheckChange(undefined);
                }
              }}
            />
            <Label htmlFor="enableNumeric">Enable Numeric Range Check</Label>
          </div>

          {numericCheck && (
            <div className="pl-6 space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Minimum Value</Label>
                  <Input
                    type="number"
                    placeholder="Min"
                    value={numericCheck.minValue ?? ''}
                    onChange={(e) => onNumericCheckChange({
                      ...numericCheck,
                      minValue: e.target.value ? Number(e.target.value) : undefined
                    })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Maximum Value</Label>
                  <Input
                    type="number"
                    placeholder="Max"
                    value={numericCheck.maxValue ?? ''}
                    onChange={(e) => onNumericCheckChange({
                      ...numericCheck,
                      maxValue: e.target.value ? Number(e.target.value) : undefined
                    })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Other Allowed Values (comma-separated)</Label>
                <Input
                  placeholder="e.g., -7, -8, -6 for special codes"
                  value={numericCheck.otherValues ?? ''}
                  onChange={(e) => onNumericCheckChange({
                    ...numericCheck,
                    otherValues: e.target.value
                  })}
                />
                <p className="text-xs text-muted-foreground">
                  Values that bypass the min/max range (e.g., Don't Know, Refuse codes)
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Error Message</Label>
                <Input
                  value={numericCheck.message}
                  onChange={(e) => onNumericCheckChange({
                    ...numericCheck,
                    message: e.target.value
                  })}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Date Range Validation */}
      {showDate && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="enableDateRange"
              checked={!!dateRange}
              onCheckedChange={(checked) => {
                if (checked) {
                  onDateRangeChange({});
                } else {
                  onDateRangeChange(undefined);
                }
              }}
            />
            <Label htmlFor="enableDateRange">Enable Date Range</Label>
          </div>

          {dateRange && (
            <div className="pl-6 space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
              <p className="text-xs text-muted-foreground">
                Use ISO date (2025-01-01), relative format (-3y, +1m), or 0 for today
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Minimum Date</Label>
                  <Input
                    placeholder="-100y or 2020-01-01"
                    value={dateRange.minDate ?? ''}
                    onChange={(e) => onDateRangeChange({
                      ...dateRange,
                      minDate: e.target.value || undefined
                    })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Maximum Date</Label>
                  <Input
                    placeholder="0 (today) or 2030-12-31"
                    value={dateRange.maxDate ?? ''}
                    onChange={(e) => onDateRangeChange({
                      ...dateRange,
                      maxDate: e.target.value || undefined
                    })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {(showNumeric || showDate) && showLogic && <Separator />}

      {/* Logic Check - Now supports multiple */}
      {showLogic && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>Custom Logic Checks</Label>
              <p className="text-xs text-muted-foreground">
                Add validation rules based on field values
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={addLogicCheck}>
              <Plus className="h-4 w-4 mr-1" />
              Add Check
            </Button>
          </div>

          <div className="space-y-3">
            {(logicCheck || []).map((check, index) => (
              <div key={index} className="p-4 rounded-lg bg-muted/30 border border-border space-y-3">
                <div className="flex items-start justify-between">
                  <Label className="text-sm font-medium">Check #{index + 1}</Label>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLogicCheck(index)}
                    className="h-8 w-8 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Condition Expression</Label>
                  <Textarea
                    placeholder="e.g., age >= 18 AND age <= 65"
                    value={check.condition}
                    onChange={(e) => updateLogicCheck(index, 'condition', e.target.value)}
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use field names and operators: =, &lt;, &gt;, &lt;=, &gt;=, &lt;&gt;, AND, OR
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Error Message</Label>
                  <Input
                    value={check.message}
                    onChange={(e) => updateLogicCheck(index, 'message', e.target.value)}
                    placeholder="Message shown when validation fails"
                  />
                </div>
              </div>
            ))}

            {(!logicCheck || logicCheck.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No custom logic checks configured. Click "Add Check" to create one.
              </p>
            )}
          </div>
        </div>
      )}

      {showLogic && showUnique && <Separator />}

      {/* Unique Check */}
      {showUnique && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="enableUnique"
              checked={!!uniqueCheck}
              onCheckedChange={(checked) => {
                if (checked) {
                  onUniqueCheckChange({ message: 'This value already exists' });
                } else {
                  onUniqueCheckChange(undefined);
                }
              }}
            />
            <Label htmlFor="enableUnique">Require Unique Value</Label>
          </div>

          {uniqueCheck && (
            <div className="pl-6 space-y-1 p-4 rounded-lg bg-muted/30 border border-border">
              <Label className="text-xs">Error Message</Label>
              <Input
                value={uniqueCheck.message}
                onChange={(e) => onUniqueCheckChange({ message: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-2">
                The value must be unique across all records in this form.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ValidationEditor;
