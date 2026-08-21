import { QuestionType } from "@/types/survey";
import { Button } from "@/components/ui/button";
import {
  Type,
  Circle,
  CheckSquare,
  ChevronDown,
  Calendar,
  Clock,
  Info,
  Calculator
} from "lucide-react";

interface QuestionTypeSelectorProps {
  onSelect: (type: QuestionType) => void;
}

const questionTypes: { type: QuestionType; label: string; icon: React.ReactNode; description: string }[] = [
  { type: 'text', label: 'Text Input', icon: <Type className="h-5 w-5" />, description: 'Free text or number entry' },
  { type: 'radio', label: 'Single Select', icon: <Circle className="h-5 w-5" />, description: 'Choose one option' },
  { type: 'checkbox', label: 'Multi Select', icon: <CheckSquare className="h-5 w-5" />, description: 'Choose multiple options' },
  { type: 'combobox', label: 'Dropdown', icon: <ChevronDown className="h-5 w-5" />, description: 'Searchable dropdown list' },
  { type: 'date', label: 'Date', icon: <Calendar className="h-5 w-5" />, description: 'Date picker' },
  { type: 'datetime', label: 'Date & Time', icon: <Clock className="h-5 w-5" />, description: 'Date and time picker' },
  { type: 'information', label: 'Information', icon: <Info className="h-5 w-5" />, description: 'Read-only display text' },
  { type: 'calculated', label: 'Calculated', icon: <Calculator className="h-5 w-5" />, description: 'Auto-computed value' },
];

const QuestionTypeSelector = ({ onSelect }: QuestionTypeSelectorProps) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {questionTypes.map(({ type, label, icon, description }) => (
        <Button
          key={type}
          variant="outline"
          className="h-auto p-4 flex flex-col items-center gap-2 hover:bg-accent"
          onClick={() => onSelect(type)}
        >
          <div className="text-primary">{icon}</div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground text-center">{description}</div>
        </Button>
      ))}
    </div>
  );
};

export default QuestionTypeSelector;
