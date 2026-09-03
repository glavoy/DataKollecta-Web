import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Download,
  Database,
  Eye,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileSpreadsheet,
  Package
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import JSZip from "jszip";
import { FormChangesView } from "@/components/FormChangesView";
import { fetchAllRows, chunkIds } from "@/lib/supabasePaging";
import { buildCsv } from "@/lib/csv";
import { groupByLineage, versionByPackageId } from "@/lib/surveyVersion";
import { useToast } from "@/hooks/use-toast";
import type { FormChange } from "@/services/submissionService";

/** A question as it arrives from the parsed survey manifest. */
interface FormField {
  fieldname?: string;
  id?: string;
  type?: string;
  text?: string;
}

interface FormWithCount {
  id: string;
  table_name: string;
  display_name: string;
  fields: FormField[];
  recordCount: number;
  /** Every version of this survey that could hold rows for this form.
      Versions of one survey deliberately SHARE a table_name -- that is what
      makes their data one dataset -- so queries scope to this whole set
      rather than a single package. Two DIFFERENT surveys in a project can
      also share a table_name, which is why the scope is still needed. */
  survey_package_ids: string[];
  /** package id -> version number, for stamping survey_version onto rows. */
  versionByPackage: Record<string, number>;
}

/** One survey and all its versions, presented as a single dataset. */
interface SurveyWithForms {
  /** The lineage's stable code -- the key for this card. */
  id: string;
  name: string;
  display_name: string;
  versionCount: number;
  forms: FormWithCount[];
  totalRecords: number;
}

interface Submission {
  id: string;
  local_unique_id: string;
  data: Record<string, unknown>;
  surveyor_id: string;
  collected_at: string;
  submitted_at: string;
  survey_package_id: string;
}

interface ProjectDataProps {
  projectId: string;
}

const ProjectData = ({ projectId }: ProjectDataProps) => {
  const { toast } = useToast();
  const [selectedForm, setSelectedForm] = useState<FormWithCount | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRecord, setSelectedRecord] = useState<Submission | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const pageSize = 25;

  // Fetch surveys with their forms and record counts
  const { data: surveysWithForms, isLoading: surveysLoading, isError: surveysIsError } = useQuery({
    queryKey: ['surveysWithForms', projectId],
    queryFn: async (): Promise<SurveyWithForms[]> => {
      // 1. Get all survey versions for the project, then group them into the
      //    surveys they are versions OF. Every version of one survey collects
      //    into a single dataset -- one SQLite file on the device -- so the
      //    portal presents them as one entry rather than one per version.
      const { data: surveys, error: surveysError } = await supabase
        .from('survey_packages')
        .select('id, name, display_name, survey_code, version, version_date')
        .eq('project_id', projectId)
        .order('version_date', { ascending: false });

      if (surveysError) throw surveysError;
      if (!surveys) return [];

      const lineages = groupByLineage(surveys);

      // 2. For each survey, get its forms with record counts across every version
      const surveysWithData = await Promise.all(
        lineages.map(async (lineage) => {
          const versionIds = lineage.versions.map((v) => v.id);
          const versionByPackage = versionByPackageId(lineage.versions);

          // Forms are the UNION across versions -- a form added in v2 must
          // appear, and one dropped after v1 must still be reachable while it
          // holds data. Ordered by version descending so the newest
          // definition of a shared table_name wins the dedupe below.
          const { data: forms } = await supabase
            .from('crfs')
            .select('id, table_name, display_name, fields, survey_package_id')
            .in('survey_package_id', versionIds)
            .order('display_order');

          if (!forms) {
            return {
              id: lineage.surveyCode,
              name: lineage.surveyCode,
              display_name: lineage.latest.display_name,
              versionCount: lineage.versions.length,
              forms: [],
              totalRecords: 0
            };
          }

          const byTable = new Map<string, typeof forms[number]>();
          for (const form of forms) {
            const existing = byTable.get(form.table_name);
            const existingVersion = existing ? versionByPackage[existing.survey_package_id] ?? 0 : -1;
            const thisVersion = versionByPackage[form.survey_package_id] ?? 0;
            if (thisVersion > existingVersion) byTable.set(form.table_name, form);
          }
          const uniqueForms = Array.from(byTable.values());

          // Get record count for each form, across every version
          const formsWithCounts = await Promise.all(
            uniqueForms.map(async (form) => {
              const { count } = await supabase
                .from('submissions')
                .select('*', { count: 'exact', head: true })
                .eq('project_id', projectId)
                .in('survey_package_id', versionIds)
                .eq('table_name', form.table_name);

              return {
                ...form,
                survey_package_ids: versionIds,
                versionByPackage,
                recordCount: count || 0,
              };
            })
          );

          return {
            id: lineage.surveyCode,
            name: lineage.surveyCode,
            display_name: lineage.latest.display_name,
            versionCount: lineage.versions.length,
            forms: formsWithCounts,
            totalRecords: formsWithCounts.reduce((sum, f) => sum + f.recordCount, 0)
          };
        })
      );

      return surveysWithData;
    },
  });

  // Fetch submissions for the selected form
  const { data: submissions, isLoading: submissionsLoading } = useQuery({
    queryKey: ['formSubmissions', projectId, selectedForm?.survey_package_ids, selectedForm?.table_name],
    queryFn: async () => {
      if (!selectedForm) return [];
      return fetchAllRows<Submission>((from, to) =>
        supabase
          .from('submissions')
          .select('id, local_unique_id, data, surveyor_id, collected_at, submitted_at, survey_package_id')
          .eq('project_id', projectId)
          .in('survey_package_id', selectedForm.survey_package_ids)
          .eq('table_name', selectedForm.table_name)
          .order('collected_at', { ascending: false })
          .range(from, to),
      );
    },
    enabled: !!selectedForm,
  });

  // Get display columns from form fields
  const displayColumns = useMemo(() => {
    if (!selectedForm?.fields || !Array.isArray(selectedForm.fields)) {
      return [];
    }

    const visibleFields = selectedForm.fields.filter((field) => {
      const type = field.type?.toLowerCase();
      if (type === 'information') return false;
      return true;
    });

    return visibleFields.slice(0, 6).map((field) => ({
      key: field.fieldname || field.id,
      label: field.text?.substring(0, 50) || field.fieldname || 'Unknown',
      fieldname: field.fieldname,
    }));
  }, [selectedForm]);

  // No filtering needed
  const filteredSubmissions = submissions || [];

  // Pagination
  const totalPages = Math.ceil((filteredSubmissions?.length || 0) / pageSize);
  const paginatedSubmissions = filteredSubmissions?.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  /**
   * One CSV per form, covering every version of the survey.
   *
   * Columns are the union across versions, which is the right shape rather
   * than a compromise: it is exactly what the phone's own SQLite ends up with
   * after _syncSurveyTable ALTER TABLEs a new question in, so a v1 row is
   * blank in a v2-only column in both places. `survey_version` leads the row
   * so a reader can always tell which version produced it -- without it, a
   * blank cell is ambiguous between "not asked in that version" and "asked
   * and skipped".
   */
  const generateCSV = (submissions: Submission[], versionByPackage: Record<string, number>): string => {
    if (!submissions || submissions.length === 0) return '';

    // Get all unique field names, sorted for a deterministic column order
    // rather than whichever submission happened to introduce a key first.
    const allFieldNames = new Set<string>();
    submissions.forEach(sub => {
      if (sub.data) {
        Object.keys(sub.data).forEach(key => allFieldNames.add(key));
      }
    });
    const fieldNames = Array.from(allFieldNames).sort();

    const headers = ['survey_version', 'local_unique_id', 'surveyor_id', 'collected_at', 'submitted_at', ...fieldNames];
    const rows = submissions.map(sub => [
      versionByPackage[sub.survey_package_id] ?? '',
      sub.local_unique_id,
      sub.surveyor_id,
      sub.collected_at,
      sub.submitted_at,
      ...fieldNames.map(fieldName => sub.data?.[fieldName]),
    ]);

    return buildCsv(headers, rows);
  };

  const generateFormChangesCSV = (formchanges: FormChange[]): string => {
    if (!formchanges || formchanges.length === 0) return '';

    const headers = ['formchanges_uuid', 'record_uuid', 'tablename', 'fieldname', 'oldvalue', 'newvalue', 'surveyor_id', 'changed_at'];
    const rows = formchanges.map(fc => [
      fc.formchanges_uuid,
      fc.record_uuid,
      fc.tablename,
      fc.fieldname,
      fc.oldvalue,
      fc.newvalue,
      fc.surveyor_id,
      fc.changed_at,
    ]);

    return buildCsv(headers, rows);
  };

  // Export single form to CSV
  const handleExportSingleForm = () => {
    if (!filteredSubmissions || filteredSubmissions.length === 0 || !selectedForm) return;

    const csvContent = generateCSV(filteredSubmissions, selectedForm.versionByPackage);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `${selectedForm.table_name}_${format(new Date(), 'yyyy-MM-dd')}.csv`;

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export every form of a survey -- across all its versions -- to one ZIP.
  const handleExportSurvey = async (surveyCode: string) => {
    const survey = surveysWithForms?.find(s => s.id === surveyCode);
    if (!survey) return;

    setExportingId(surveyCode);

    try {
      const zip = new JSZip();
      const versionIds = survey.forms[0]?.survey_package_ids ?? [];

      // Export each form to CSV and add to ZIP -- paged, not a single
      // select(), or a form with more than max_rows submissions silently
      // ships an incomplete CSV inside an otherwise "successful" export.
      for (const form of survey.forms) {
        const formSubmissions = await fetchAllRows((from, to) =>
          supabase
            .from('submissions')
            .select('*')
            .eq('project_id', projectId)
            .in('survey_package_id', form.survey_package_ids)
            .eq('table_name', form.table_name)
            .range(from, to),
        );

        if (formSubmissions.length > 0) {
          const csvContent = generateCSV(formSubmissions, form.versionByPackage);
          zip.file(`${form.table_name}.csv`, csvContent);
        }
      }

      // Export formchanges for this survey.
      //
      // formchanges carries no survey link of its own -- only record_uuid,
      // which is a submission's local_unique_id -- so the record ids have to
      // be gathered first, across every version.
      const surveySubmissions = versionIds.length === 0 ? [] : await fetchAllRows<{ local_unique_id: string }>((from, to) =>
        supabase
          .from('submissions')
          .select('local_unique_id')
          .in('survey_package_id', versionIds)
          .range(from, to),
      );

      if (surveySubmissions.length > 0) {
        const recordUuids = surveySubmissions.map(s => s.local_unique_id);

        // `.in()` on a GET request has a querystring length ceiling well
        // under what 1000+ UUIDs need, so this is chunked rather than one
        // call -- an unchunked `.in()` here previously failed as a 414 with
        // its error silently discarded, dropping formchanges.csv from the
        // export with no indication anything went wrong.
        const formchanges = (
          await Promise.all(
            chunkIds(recordUuids).map((chunk) =>
              fetchAllRows((from, to) =>
                supabase.from('formchanges').select('*').in('record_uuid', chunk).range(from, to),
              ),
            ),
          )
        ).flat();

        if (formchanges.length > 0) {
          const csvContent = generateFormChangesCSV(formchanges);
          zip.file('formchanges.csv', csvContent);
        }
      }

      // Generate and download ZIP
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${survey.name}_data_${format(new Date(), 'yyyy-MM-dd')}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: "Export failed",
        description: "Could not export this survey's data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setExportingId(null);
    }
  };

  const handleSelectForm = (form: FormWithCount) => {
    setSelectedForm(form);
    setCurrentPage(1);
    // Removed searchTerm clear and scroll since search is gone and we use a dialog
  };

  const getFieldValue = (data: Record<string, unknown>, fieldname: string) => {
    const value = data?.[fieldname];
    if (value === null || value === undefined) return '-';
    const str = String(value);
    return str.length > 30 ? str.substring(0, 30) + '...' : str;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">Data</h2>
        <p className="text-sm text-muted-foreground">
          View and export collected data for this project
        </p>
      </div>

      {/* Survey Cards */}
      {surveysLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : surveysIsError ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileSpreadsheet className="h-12 w-12 text-destructive mb-3" />
            <p className="text-muted-foreground">Failed to load surveys. Please try again.</p>
          </CardContent>
        </Card>
      ) : surveysWithForms && surveysWithForms.length > 0 ? (
        <div className="space-y-4">
          {surveysWithForms.map((survey) => (
            <Card key={survey.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="h-5 w-5" />
                      {survey.display_name}
                    </CardTitle>
                    <CardDescription>
                      {survey.forms.length} form{survey.forms.length !== 1 ? 's' : ''} • {survey.totalRecords} total record{survey.totalRecords !== 1 ? 's' : ''}
                      {survey.versionCount > 1 && (
                        <> • {survey.versionCount} versions, merged</>
                      )}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handleExportSurvey(survey.id)}
                    disabled={survey.totalRecords === 0 || exportingId === survey.id}
                  >
                    {exportingId === survey.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Export All
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {survey.forms.length > 0 ? (
                  <div className="space-y-2">
                    {survey.forms.map((form) => (
                      <div
                        key={form.id}
                        className={`flex items-center justify-between p-3 border rounded-lg transition-colors hover:bg-accent cursor-pointer`}
                        onClick={() => handleSelectForm(form)}
                      >
                        <div>
                          <p className="font-medium">{form.display_name}</p>
                          <p className="text-sm text-muted-foreground">{form.table_name}</p>
                        </div>
                        <Badge variant={form.recordCount > 0 ? 'secondary' : 'outline'}>
                          {form.recordCount} record{form.recordCount !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No forms in this survey</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No surveys found. Upload or create a survey first.</p>
          </CardContent>
        </Card>
      )}

      {/* Main Data Table Dialog */}
      <Dialog open={!!selectedForm} onOpenChange={(open) => !open && setSelectedForm(null)}>
        <DialogContent className="max-w-[95vw] w-full h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-6 border-b shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>{selectedForm?.display_name}</DialogTitle>
                <DialogDescription>
                  {submissionsLoading
                    ? "Loading..."
                    : `${filteredSubmissions?.length || 0} record${filteredSubmissions?.length !== 1 ? 's' : ''}`}
                </DialogDescription>
              </div>
              <div className="flex gap-2 mr-8"> {/* mr-8 to avoid overlap with close button */}
                <Button
                  variant="outline"
                  onClick={handleExportSingleForm}
                  disabled={!filteredSubmissions?.length}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export This Form
                </Button>
              </div>
            </div>

          </DialogHeader>

          <div className="flex-1 overflow-auto p-6 bg-muted/10">
            {submissionsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : paginatedSubmissions && paginatedSubmissions.length > 0 ? (
              <div className="grid gap-4">
                <div className="border rounded-md bg-background overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">ID</TableHead>
                        <TableHead>Surveyor</TableHead>
                        <TableHead>Collected</TableHead>
                        {displayColumns.map(col => (
                          <TableHead key={col.key} title={col.label}>
                            {col.fieldname}
                          </TableHead>
                        ))}
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedSubmissions.map((submission) => (
                        <TableRow key={submission.id}>
                          <TableCell className="font-mono text-xs">
                            {submission.local_unique_id?.substring(0, 8)}...
                          </TableCell>
                          <TableCell className="text-sm">
                            {submission.surveyor_id || '-'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {submission.collected_at
                              ? format(new Date(submission.collected_at), 'yyyy-MM-dd HH:mm')
                              : '-'}
                          </TableCell>
                          {displayColumns.map(col => (
                            <TableCell key={col.key} className="text-sm max-w-[150px] truncate">
                              {getFieldValue(submission.data, col.fieldname)}
                            </TableCell>
                          ))}
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setSelectedRecord(submission)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Page {currentPage} of {totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Database className="h-12 w-12 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">
                  No data collected yet for this form.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Record Detail Dialog */}
      <Dialog open={!!selectedRecord} onOpenChange={(open) => !open && setSelectedRecord(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Details</DialogTitle>
            <DialogDescription>
              ID: {selectedRecord?.local_unique_id}
            </DialogDescription>
          </DialogHeader>

          {selectedRecord && (
            <div className="space-y-4">
              {/* Metadata */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-md">
                <div>
                  <p className="text-sm font-medium">Surveyor</p>
                  <p className="text-sm text-muted-foreground">{selectedRecord.surveyor_id || '-'}</p>
                </div>
                <div>
                  <p className="text-sm font-medium">Collected</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedRecord.collected_at
                      ? format(new Date(selectedRecord.collected_at), 'yyyy-MM-dd HH:mm:ss')
                      : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Submitted</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedRecord.submitted_at
                      ? format(new Date(selectedRecord.submitted_at), 'yyyy-MM-dd HH:mm:ss')
                      : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Form</p>
                  <p className="text-sm text-muted-foreground">{selectedForm?.display_name}</p>
                </div>
              </div>

              {/* Field Data */}
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">Field</TableHead>
                      <TableHead>Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedRecord.data && Object.entries(selectedRecord.data)
                      .filter(([key]) => !key.startsWith('_'))
                      .map(([key, value]) => (
                        <TableRow key={key}>
                          <TableCell className="font-mono text-sm">{key}</TableCell>
                          <TableCell className="text-sm">
                            {value === null || value === undefined
                              ? <span className="text-muted-foreground">-</span>
                              : String(value)}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>

              {/* Edit history */}
              {selectedRecord.local_unique_id && (
                <div>
                  <p className="text-sm font-medium mb-2">History</p>
                  <FormChangesView recordUuid={selectedRecord.local_unique_id} />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectData;
