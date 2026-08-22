import { SurveyPackage, CsvFile, SurveyForm } from "@/types/survey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetFooter,
} from "@/components/ui/sheet";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState, useEffect, useRef } from "react";
import { Trash2, Upload, FileSpreadsheet, ChevronUp, ChevronDown, Info, FileText } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface GlobalSettingsEditorProps {
    surveyPackage: SurveyPackage;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (pkg: SurveyPackage) => void;
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

const GlobalSettingsEditor = ({ surveyPackage, open, onOpenChange, onSave }: GlobalSettingsEditorProps) => {
    const [editedPackage, setEditedPackage] = useState<SurveyPackage>({ ...surveyPackage });
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        // Deep copy to preserve forms array. Deliberately keyed on `open`
        // alone: this is a modal edit buffer, so the only correct time to
        // seed it is the moment it opens. Depending on `surveyPackage` too
        // meant any edit elsewhere while the sheet was open -- including
        // this sheet's own save, which changes the package's identity --
        // could re-seed the buffer out from under whatever the user had
        // just typed into it.
        setEditedPackage({
            ...surveyPackage,
            forms: surveyPackage.forms.map(f => ({ ...f })),
            csvFiles: surveyPackage.csvFiles?.map(c => ({ ...c })) || []
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above; re-seeding on surveyPackage changes is the bug being fixed
    }, [open]);

    const update = <K extends keyof SurveyPackage>(field: K, value: SurveyPackage[K]) => {
        setEditedPackage(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = () => {
        // Update display_order based on array position before saving
        const updatedForms = editedPackage.forms.map((form, index) => ({
            ...form,
            displayOrder: (index + 1) * 10 // 10, 20, 30, etc.
        }));
        onSave({ ...editedPackage, forms: updatedForms });
        onOpenChange(false);
    };

    // Auto-generate ID and DB name from name if they are empty
    const handleNameBlur = () => {
        const sanitized = editedPackage.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (!editedPackage.surveyId) {
            update('surveyId', sanitized);
        }

        if (!editedPackage.databaseName) {
            update('databaseName', `${sanitized}.sqlite`);
        }
    };

    const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;

        const newCsvFiles: CsvFile[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.name.toLowerCase().endsWith('.csv')) {
                const content = await file.text();
                newCsvFiles.push({
                    id: crypto.randomUUID(),
                    filename: file.name,
                    content: content
                });
            }
        }

        const existingFiles = editedPackage.csvFiles || [];
        // Filter out duplicates by filename
        const filteredNew = newCsvFiles.filter(
            newFile => !existingFiles.some(existing => existing.filename === newFile.filename)
        );

        update('csvFiles', [...existingFiles, ...filteredNew]);

        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleRemoveCsv = (id: string) => {
        const csvFiles = editedPackage.csvFiles || [];
        update('csvFiles', csvFiles.filter(f => f.id !== id));
    };

    // Form reordering functions
    const moveFormUp = (index: number) => {
        if (index === 0) return;
        const newForms = [...editedPackage.forms];
        [newForms[index - 1], newForms[index]] = [newForms[index], newForms[index - 1]];
        update('forms', newForms);
    };

    const moveFormDown = (index: number) => {
        if (index === editedPackage.forms.length - 1) return;
        const newForms = [...editedPackage.forms];
        [newForms[index], newForms[index + 1]] = [newForms[index + 1], newForms[index]];
        update('forms', newForms);
    };

    const csvFiles = editedPackage.csvFiles || [];
    const forms = editedPackage.forms || [];

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-lg overflow-hidden flex flex-col">
                <SheetHeader>
                    <SheetTitle>Global Survey Settings</SheetTitle>
                    <SheetDescription>
                        Configure global properties for the survey package.
                    </SheetDescription>
                </SheetHeader>

                <ScrollArea className="flex-1 -mx-6 px-6">
                    <div className="space-y-6 py-6">
                        {/* Survey Identification */}
                        <div className="space-y-4">
                            <div className="flex items-center">
                                <Label className="text-base font-semibold">Survey Identification</Label>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center">
                                    <Label htmlFor="surveyName">Survey Name (Display Name)</Label>
                                    <InfoTooltip text="Human-readable name shown to users. This is the friendly name for the survey." />
                                </div>
                                <Input
                                    id="surveyName"
                                    value={editedPackage.name}
                                    onChange={(e) => update('name', e.target.value)}
                                    onBlur={handleNameBlur}
                                    placeholder="e.g., Household Survey 2024"
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center">
                                    <Label htmlFor="surveyId">Survey ID (Unique)</Label>
                                    <InfoTooltip text="Unique identifier for the survey. This becomes the zip filename and is used internally. Include version info here (e.g., geoff_css_2026-01-24 or geoff_css_v1.2)." />
                                </div>
                                <Input
                                    id="surveyId"
                                    value={editedPackage.surveyId}
                                    onChange={(e) => update('surveyId', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_'))}
                                    placeholder="e.g., household_survey_2024"
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center">
                                    <Label htmlFor="databaseName">Database Name</Label>
                                    <InfoTooltip text="Name of the SQLite database file created on the mobile device. Usually matches the survey ID with .sqlite extension." />
                                </div>
                                <Input
                                    id="databaseName"
                                    value={editedPackage.databaseName || ''}
                                    onChange={(e) => update('databaseName', e.target.value)}
                                    placeholder="e.g., household_db.sqlite"
                                />
                            </div>
                        </div>

                        {/* Form Display Order Section */}
                        <div className="space-y-4 pt-4 border-t">
                            <div className="flex items-center">
                                <Label className="text-base font-semibold">Form Display Order</Label>
                                <InfoTooltip text="The order forms appear in the mobile app. Use the arrows to reorder. display_order values are assigned automatically (10, 20, 30...)." />
                            </div>

                            {forms.length === 0 ? (
                                <div className="text-center py-6 border-2 border-dashed rounded-lg">
                                    <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                                    <p className="text-sm text-muted-foreground">
                                        No forms in this survey yet.
                                    </p>
                                </div>
                            ) : (
                                <div className="border rounded-lg">
                                    {forms.map((form, index) => (
                                        <div
                                            key={form.id}
                                            className={`flex items-center justify-between p-3 ${index !== forms.length - 1 ? 'border-b' : ''
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="text-sm font-mono text-muted-foreground w-6">
                                                    {index + 1}.
                                                </span>
                                                <div>
                                                    <div className="font-medium text-sm">{form.displayname}</div>
                                                    <div className="text-xs text-muted-foreground">{form.tablename}.xml</div>
                                                </div>
                                                {!form.parenttable ? (
                                                    <Badge variant="secondary" className="text-xs">Base</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-xs">Child of {form.parenttable}</Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() => moveFormUp(index)}
                                                    disabled={index === 0}
                                                >
                                                    <ChevronUp className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() => moveFormDown(index)}
                                                    disabled={index === forms.length - 1}
                                                >
                                                    <ChevronDown className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* CSV Files Section */}
                        <div className="space-y-4 pt-4 border-t">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center">
                                    <Label className="text-base font-semibold">CSV Data Files</Label>
                                    <InfoTooltip text="CSV files used for dynamic response options (dropdowns that load from external data). These are bundled into the zip file." />
                                </div>
                                <div>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".csv"
                                        multiple
                                        onChange={handleCsvUpload}
                                        className="hidden"
                                        id="csv-upload"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <Upload className="h-4 w-4 mr-2" />
                                        Add CSV Files
                                    </Button>
                                </div>
                            </div>

                            {csvFiles.length === 0 ? (
                                <div className="text-center py-8 border-2 border-dashed rounded-lg">
                                    <FileSpreadsheet className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                                    <p className="text-sm text-muted-foreground">
                                        No CSV files added yet.
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Upload CSV files to use for dynamic dropdown options.
                                    </p>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Filename</TableHead>
                                            <TableHead className="w-[80px]">Size</TableHead>
                                            <TableHead className="w-[60px]"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {csvFiles.map((file) => (
                                            <TableRow key={file.id}>
                                                <TableCell className="font-mono text-sm">
                                                    {file.filename}
                                                </TableCell>
                                                <TableCell className="text-muted-foreground text-xs">
                                                    {(file.content.length / 1024).toFixed(1)} KB
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                                        onClick={() => handleRemoveCsv(file.id)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </div>
                    </div>
                </ScrollArea>

                <SheetFooter className="mt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave}>
                        Save Settings
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
};

export default GlobalSettingsEditor;
