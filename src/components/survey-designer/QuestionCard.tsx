import { SurveyQuestion } from "@/types/survey";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  GripVertical,
  Pencil,
  Copy,
  Trash2,
  Type,
  Circle,
  CheckSquare,
  ChevronDown,
  Calendar,
  Clock,
  Info,
  Calculator,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface QuestionCardProps {
  question: SurveyQuestion;
  index: number;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Counts, not the findings themselves -- a message-text edit shouldn't re-render every card. */
  errorCount?: number;
  warningCount?: number;
}

const typeIcons: Record<string, React.ReactNode> = {
  text: <Type className="h-4 w-4" />,
  radio: <Circle className="h-4 w-4" />,
  checkbox: <CheckSquare className="h-4 w-4" />,
  combobox: <ChevronDown className="h-4 w-4" />,
  date: <Calendar className="h-4 w-4" />,
  datetime: <Clock className="h-4 w-4" />,
  information: <Info className="h-4 w-4" />,
  calculated: <Calculator className="h-4 w-4" />,
  automatic: <Calculator className="h-4 w-4" />, // Legacy support
};

const typeLabels: Record<string, string> = {
  text: 'Text',
  radio: 'Single Select',
  checkbox: 'Multi Select',
  combobox: 'Dropdown',
  date: 'Date',
  datetime: 'Date & Time',
  information: 'Information',
  calculated: 'Calculated',
  automatic: 'Calculated', // Legacy support
};

// Color coding for different question types
const typeColors: Record<string, string> = {
  text: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  radio: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  checkbox: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
  combobox: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  date: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  datetime: 'bg-teal-500/10 text-teal-600 border-teal-500/20',
  information: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  calculated: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
  automatic: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
};

const QuestionCard = ({ question, index, onEdit, onDuplicate, onDelete, errorCount = 0, warningCount = 0 }: QuestionCardProps) => {
  const hasValidation = question.numericCheck || question.dateRange ||
    (question.logicCheck && question.logicCheck.length > 0) || question.uniqueCheck;
  const hasSkipLogic = (question.preskip && question.preskip.length > 0) || (question.postskip && question.postskip.length > 0);
  const hasDynamicResponses = !!question.dynamicResponses;
  const typeColor = typeColors[question.type] || typeColors.text;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`${errorCount > 0 ? 'border-destructive/60' : 'border-border'} bg-card hover:border-primary/50 hover:shadow-md transition-all duration-200 group min-w-0 w-full rounded-xl overflow-hidden`}
    >
      <CardContent className="p-0">
        {/* Colored accent bar at top */}
        <div className={`h-1 w-full ${typeColor.split(' ')[0]}`} />

        <div className="p-4">
          <div className="flex items-start gap-3 w-full">
            <div
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground mt-1 opacity-50 group-hover:opacity-100 transition-opacity touch-none"
            >
              <GripVertical className="h-5 w-5" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-sm font-bold text-muted-foreground flex-shrink-0 bg-muted px-2 py-0.5 rounded">
                  Q{index + 1}
                </span>
                <Badge className={`flex items-center gap-1.5 flex-shrink-0 border ${typeColor}`}>
                  {typeIcons[question.type]}
                  {typeLabels[question.type]}
                </Badge>
                <Badge variant="outline" className="font-mono text-xs truncate max-w-[200px] bg-muted/50" title={question.fieldname}>
                  {question.fieldname}
                </Badge>
                {errorCount > 0 && (
                  <Badge variant="destructive" className="text-xs flex-shrink-0 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errorCount === 1 ? '1 error' : `${errorCount} errors`}
                  </Badge>
                )}
                {warningCount > 0 && (
                  <Badge variant="outline" className="text-xs flex-shrink-0 flex items-center gap-1 border-amber-500/50 text-amber-600">
                    <AlertTriangle className="h-3 w-3" />
                    {warningCount === 1 ? '1 warning' : `${warningCount} warnings`}
                  </Badge>
                )}
                {hasValidation && (
                  <Badge variant="default" className="text-xs flex-shrink-0 bg-orange-500/80 hover:bg-orange-500">
                    Validation
                  </Badge>
                )}
                {hasSkipLogic && (
                  <Badge variant="default" className="text-xs flex-shrink-0 bg-sky-500/80 hover:bg-sky-500">
                    Skip Logic
                  </Badge>
                )}
                {hasDynamicResponses && (
                  <Badge variant="default" className="text-xs flex-shrink-0 bg-green-500/80 hover:bg-green-500">
                    Dynamic
                  </Badge>
                )}
              </div>

              <p className="text-foreground break-words text-sm mb-2 line-clamp-3 leading-relaxed">
                {question.text || <span className="text-muted-foreground italic">No question text</span>}
              </p>

              {question.responses && question.responses.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {question.responses.slice(0, 5).map((resp, i) => (
                    <Badge key={i} variant="outline" className="text-xs bg-muted/30">
                      {resp.value}: {resp.label || '(no label)'}
                    </Badge>
                  ))}
                  {question.responses.length > 5 && (
                    <Badge variant="outline" className="text-xs bg-muted/50">
                      +{question.responses.length - 5} more
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" onClick={onEdit} className="hover:bg-primary/10">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onDuplicate} className="hover:bg-primary/10">
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onDelete} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default QuestionCard;
