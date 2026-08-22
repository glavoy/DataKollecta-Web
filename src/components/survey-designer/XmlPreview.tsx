import { SurveyForm, SurveyPackage } from "@/types/survey";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateFormXml, generateManifestGistx, downloadFile, downloadSurveyZip } from "@/lib/xmlGenerator";
import { Copy, Download, FileArchive, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import type { ValidationReport } from "@/lib/validation";

interface XmlPreviewProps {
  surveyPackage: SurveyPackage;
  currentForm: SurveyForm | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ValidationReport;
  onReviewIssues: () => void;
}

const XmlPreview = ({ surveyPackage, currentForm, open, onOpenChange, report, onReviewIssues }: XmlPreviewProps) => {
  const formXml = currentForm ? generateFormXml(currentForm) : '';
  const manifestJson = generateManifestGistx(surveyPackage);

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${type} copied to clipboard`);
  };

  const handleDownloadXml = () => {
    if (currentForm) {
      downloadFile(formXml, `${currentForm.tablename}.xml`, 'text/xml');
      toast.success('XML file downloaded');
    }
  };

  const handleDownloadManifest = () => {
    downloadFile(manifestJson, 'survey_manifest.gistx', 'application/json');
    toast.success('Manifest file downloaded');
  };

  const handleDownloadZip = async () => {
    // Blocked here, not on the per-form XML/manifest downloads above --
    // those are how an author inspects the XML to understand an error they
    // were just shown, and blocking them would be actively hostile to that.
    if (report.hasErrors) {
      toast.error(
        `${report.errorCount} error${report.errorCount === 1 ? '' : 's'} must be fixed before exporting.`,
        { action: { label: 'Review', onClick: onReviewIssues } },
      );
      return;
    }

    try {
      await downloadSurveyZip(surveyPackage);
      toast.success('Survey package downloaded');
    } catch (error) {
      console.error('Failed to generate zip:', error);
      toast.error('Failed to generate zip file');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Preview & Export</DialogTitle>
          <DialogDescription>
            Review the generated XML and manifest files before exporting
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="xml" className="flex-1 overflow-hidden flex flex-col">
          <TabsList>
            <TabsTrigger value="xml">Form XML</TabsTrigger>
            <TabsTrigger value="manifest">Manifest (GISTX)</TabsTrigger>
          </TabsList>

          <TabsContent value="xml" className="flex-1 overflow-hidden mt-4">
            {currentForm ? (
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{currentForm.tablename}.xml</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => copyToClipboard(formXml, 'XML')}>
                      <Copy className="h-4 w-4 mr-1" />
                      Copy
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDownloadXml}>
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
                <div className="border border-border rounded-lg bg-muted/30 overflow-auto" style={{ height: 'calc(90vh - 300px)' }}>
                  <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
                    {formXml}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8">
                Select a form to preview its XML
              </p>
            )}
          </TabsContent>

          <TabsContent value="manifest" className="flex-1 overflow-hidden mt-4">
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">survey_manifest.gistx</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(manifestJson, 'Manifest')}>
                    <Copy className="h-4 w-4 mr-1" />
                    Copy
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDownloadManifest}>
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </Button>
                </div>
              </div>
              <div className="border border-border rounded-lg bg-muted/30 overflow-auto" style={{ height: 'calc(90vh - 300px)' }}>
                <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
                  {manifestJson}
                </pre>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4 items-center">
          {report.hasErrors && (
            <span className="text-sm text-destructive flex items-center gap-1.5 mr-auto">
              <AlertCircle className="h-4 w-4" />
              {report.errorCount} error{report.errorCount === 1 ? '' : 's'} must be fixed to export
            </span>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleDownloadZip}>
            <FileArchive className="h-4 w-4 mr-2" />
            Download Zip Package
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default XmlPreview;
