import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Download,
  Database,
  Eye,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileSpreadsheet,
  FlaskConical,
  Package,
  Tags,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import JSZip from "jszip";
import { FormChangesView } from "@/components/FormChangesView";
import { fetchAllRows, chunkIds } from "@/lib/supabasePaging";
import {
  buildFormChangesCsv,
  buildSubmissionsCsv,
  declaredColumns,
  orderRecordEntries,
  type ExportField,
  type ExportFormChange,
  type ExportSubmission,
} from "@/lib/dataExport";
import { groupByLineage, versionByPackageId } from "@/lib/surveyVersion";
import { useToast } from "@/hooks/use-toast";
import { buildExportManifest } from "@/lib/exportManifest";
import { buildCsv } from "@/lib/csv";
import {
  countFor,
  DATA_STATUS_FILTER_LABELS,
  DATA_STATUS_FILTERS,
  DEFAULT_DATA_STATUS_FILTER,
  exportFileSuffix,
  exportScopeLabel,
  parseDataStatusFilter,
  withDataStatus,
  type DataStatus,
  type DataStatusCounts,
  type DataStatusFilter,
} from "@/lib/dataStatus";
import { HelpLink } from "@/components/docs/HelpLink";
import { cn } from "@/lib/utils";

/** A question as it arrives from the parsed survey manifest. */
type FormField = ExportField;

interface FormWithCount {
  id: string;
  table_name: string;
  display_name: string;
  fields: FormField[];
  /** Whether this form declares a parent, i.e. carries `parent_uniqueid`. */
  parent_table: string | null;
  /** Every question this table_name declares in ANY version of the survey.
      Used to give a form holding no rows a header, where `fields` alone would
      only describe the newest version. */
  allFields: FormField[];
  /** Records per data_status, across every version. */
  recordCounts: DataStatusCounts;
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
  totalRecords: DataStatusCounts;
}

interface Submission {
  id: string;
  local_unique_id: string;
  data: Record<string, unknown>;
  surveyor_id: string;
  collected_at: string;
  submitted_at: string;
  survey_package_id: string;
  data_status: DataStatus;
}

interface ProjectDataProps {
  projectId: string;
  /** The viewer's project role; only an owner may reclassify records. */
  userRole?: string | null;
}

const NO_RECORDS: DataStatusCounts = { test: 0, deployed: 0 };

const sumCounts = (counts: DataStatusCounts[]): DataStatusCounts =>
  counts.reduce((sum, c) => ({ test: sum.test + c.test, deployed: sum.deployed + c.deployed }), NO_RECORDS);

const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? 's' : ''}`;

const ProjectData = ({ projectId, userRole }: ProjectDataProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isOwner = userRole === 'owner';
  // In the URL rather than local storage, so a link to "this project's test
  // data" means the same thing to whoever opens it.
  const [searchParams, setSearchParams] = useSearchParams();
  const dataFilter = parseDataStatusFilter(searchParams.get('data'));
  const setDataFilter = (filter: DataStatusFilter) => {
    const next = new URLSearchParams(searchParams);
    if (filter === DEFAULT_DATA_STATUS_FILTER) next.delete('data');
    else next.set('data', filter);
    setSearchParams(next, { replace: true });
    setCurrentPage(1);
    setSelectedIds(new Set());
  };
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const [reclassifyTarget, setReclassifyTarget] = useState<DataStatus>('test');
  const [reclassifyReason, setReclassifyReason] = useState('');
  const [reclassifying, setReclassifying] = useState(false);
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
            .select('id, table_name, display_name, fields, parent_table, survey_package_id')
            .in('survey_package_id', versionIds)
            .order('display_order');

          if (!forms) {
            return {
              id: lineage.surveyCode,
              name: lineage.surveyCode,
              display_name: lineage.latest.display_name,
              versionCount: lineage.versions.length,
              forms: [],
              totalRecords: NO_RECORDS,
            };
          }

          // The newest definition of each table_name -- that is what the data
          // browser should show.
          const byTable = new Map<string, typeof forms[number]>();
          for (const form of forms) {
            const existing = byTable.get(form.table_name);
            const existingVersion = existing ? versionByPackage[existing.survey_package_id] ?? 0 : -1;
            const thisVersion = versionByPackage[form.survey_package_id] ?? 0;
            if (thisVersion > existingVersion) byTable.set(form.table_name, form);
          }

          // Every question a table_name declares in ANY version. An export needs
          // the union rather than the newest definition: a form holding no rows
          // gets its header from here, and it has to match the union of columns
          // a populated CSV would carry.
          //
          // Built in its own pass, newest version first, because it is ORDERED
          // and that order becomes the CSV's column order. A Map keeps
          // first-seen position, so this reads as the newest version's XML
          // order followed by whatever only older versions declared. The query
          // above orders by display_order, a form-level key that says nothing
          // about which version a row came from, so without this sort the
          // column order would depend on however Postgres happened to return
          // the rows. The pass above stays on the original order, so the list
          // of forms on screen keeps its display_order.
          const fieldsByTable = new Map<string, Map<string, FormField>>();
          const formsNewestFirst = [...forms].sort(
            (a, b) =>
              (versionByPackage[b.survey_package_id] ?? 0) -
              (versionByPackage[a.survey_package_id] ?? 0),
          );
          for (const form of formsNewestFirst) {
            let union = fieldsByTable.get(form.table_name);
            if (!union) {
              union = new Map<string, FormField>();
              fieldsByTable.set(form.table_name, union);
            }
            for (const field of (form.fields as FormField[] | null) ?? []) {
              if (field?.fieldname) union.set(field.fieldname, field);
            }
          }
          const uniqueForms = Array.from(byTable.values());

          // Record counts for each form, across every version, per
          // data_status -- both are always fetched so the filter can show what
          // it is hiding, and switching it needs no refetch.
          const countOf = async (tableName: string, status: DataStatus) => {
            const { count, error } = await supabase
              .from('submissions')
              .select('*', { count: 'exact', head: true })
              .eq('project_id', projectId)
              .in('survey_package_id', versionIds)
              .eq('table_name', tableName)
              .eq('data_status', status);
            if (error) throw error;
            return count || 0;
          };
          const formsWithCounts = await Promise.all(
            uniqueForms.map(async (form) => {
              const [test, deployed] = await Promise.all([
                countOf(form.table_name, 'test'),
                countOf(form.table_name, 'deployed'),
              ]);

              return {
                ...form,
                allFields: Array.from(fieldsByTable.get(form.table_name)?.values() ?? []),
                survey_package_ids: versionIds,
                versionByPackage,
                recordCounts: { test, deployed },
              };
            })
          );

          return {
            id: lineage.surveyCode,
            name: lineage.surveyCode,
            display_name: lineage.latest.display_name,
            versionCount: lineage.versions.length,
            forms: formsWithCounts,
            totalRecords: sumCounts(formsWithCounts.map((f) => f.recordCounts)),
          };
        })
      );

      return surveysWithData;
    },
  });

  // Fetch submissions for the selected form
  const { data: submissions, isLoading: submissionsLoading } = useQuery({
    queryKey: ['formSubmissions', projectId, selectedForm?.survey_package_ids, selectedForm?.table_name, dataFilter],
    queryFn: async () => {
      if (!selectedForm) return [];
      return fetchAllRows<Submission>((from, to) =>
        withDataStatus(
          supabase
            .from('submissions')
            .select('id, local_unique_id, data, surveyor_id, collected_at, submitted_at, survey_package_id, data_status')
            .eq('project_id', projectId)
            .in('survey_package_id', selectedForm.survey_package_ids)
            .eq('table_name', selectedForm.table_name),
          dataFilter,
        )
          .order('collected_at', { ascending: false })
          .range(from, to),
      );
    },
    enabled: !!selectedForm,
  });

  /**
   * Every column this form declares, in package-XML order -- the same list the
   * export builds its header from, so what is read on screen and what is read
   * in the CSV are in one order.
   */
  const orderedColumnNames = useMemo(
    () =>
      selectedForm
        ? declaredColumns(selectedForm.allFields, { hasParent: !!selectedForm.parent_table })
        : [],
    [selectedForm],
  );

  // The first few questions, as a preview in the table. Drawn from allFields
  // rather than fields so a question that only an older version asked is still
  // reachable, and left in array order because that is already XML order.
  const displayColumns = useMemo(() => {
    if (!selectedForm?.allFields || !Array.isArray(selectedForm.allFields)) {
      return [];
    }

    const visibleFields = selectedForm.allFields.filter((field) => {
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

  // Already narrowed to the data filter by the query.
  const filteredSubmissions = submissions || [];

  const projectCounts = sumCounts((surveysWithForms ?? []).map((s) => s.totalRecords));

  const allSelected = filteredSubmissions.length > 0 && filteredSubmissions.every((s) => selectedIds.has(s.id));
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(filteredSubmissions.map((s) => s.id)));
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openReclassify = () => {
    // Default to the label the selection mostly does NOT have -- the usual
    // case is late-synced test records that arrived stamped deployed.
    const selected = filteredSubmissions.filter((s) => selectedIds.has(s.id));
    const testCount = selected.filter((s) => s.data_status === 'test').length;
    setReclassifyTarget(testCount > selected.length / 2 ? 'deployed' : 'test');
    setReclassifyReason('');
    setReclassifyOpen(true);
  };

  const handleReclassify = async () => {
    const reason = reclassifyReason.trim();
    if (!reason || selectedIds.size === 0) return;
    setReclassifying(true);
    try {
      const { data: changed, error } = await supabase.rpc('reclassify_submissions', {
        p_project_id: projectId,
        p_ids: [...selectedIds],
        p_data_status: reclassifyTarget,
        p_reason: reason,
      });
      if (error) throw error;
      toast({
        title: 'Records reclassified',
        description: `${plural(Number(changed) || 0, 'record')} marked ${reclassifyTarget}. The change is in the audit trail.`,
      });
      setReclassifyOpen(false);
      setSelectedIds(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['surveysWithForms', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['formSubmissions', projectId] }),
      ]);
    } catch (error) {
      toast({
        title: 'Reclassify failed',
        description: error instanceof Error ? error.message : 'The records could not be reclassified.',
        variant: 'destructive',
      });
    } finally {
      setReclassifying(false);
    }
  };

  // Pagination
  const totalPages = Math.ceil((filteredSubmissions?.length || 0) / pageSize);
  const paginatedSubmissions = filteredSubmissions?.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Export single form to CSV
  const handleExportSingleForm = async () => {
    if (!filteredSubmissions || filteredSubmissions.length === 0 || !selectedForm) return;
    try {
    const csvContent = buildSubmissionsCsv(
      filteredSubmissions,
      selectedForm.versionByPackage,
      orderedColumnNames,
    );
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const filename = `${selectedForm.table_name}${exportFileSuffix(dataFilter)}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    const manifest = await buildExportManifest({ [filename]: csvContent }, {
      exportId: crypto.randomUUID(), createdAt: new Date().toISOString(), projectId,
      scope: `filtered form ${selectedForm.table_name}; ${exportScopeLabel(dataFilter)}`,
    });
    const { error } = await supabase.rpc('record_data_export', {
      p_project_id: projectId,
      p_details: { ...manifest, record_count: filteredSubmissions.length, data_status_filter: dataFilter, outcome: 'prepared' },
    });
    if (error) throw error;
    const url = URL.createObjectURL(blob);

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    const manifestUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
    link.href = manifestUrl; link.download = `${filename}.manifest.json`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(manifestUrl);
    } catch {
      toast({ title: 'Export failed', description: 'The data could not be prepared or its export record saved.', variant: 'destructive' });
    }
  };

  // Export every form of a survey -- across all its versions -- to one ZIP.
  const handleExportSurvey = async (surveyCode: string) => {
    const survey = surveysWithForms?.find(s => s.id === surveyCode);
    if (!survey) return;

    setExportingId(surveyCode);

    try {
      const zip = new JSZip();
      const exportFiles: Record<string, string> = {};
      const versionIds = survey.forms[0]?.survey_package_ids ?? [];

      // Export each form to CSV and add to ZIP -- paged, not a single
      // select(), or a form with more than max_rows submissions silently
      // ships an incomplete CSV inside an otherwise "successful" export.
      for (const form of survey.forms) {
        const formSubmissions = await fetchAllRows<ExportSubmission>((from, to) =>
          withDataStatus(
            supabase
              .from('submissions')
              .select('*')
              .eq('project_id', projectId)
              .in('survey_package_id', form.survey_package_ids)
              .eq('table_name', form.table_name),
            dataFilter,
          )
            .order('id')
            .range(from, to),
        );

        // Unconditional: a form with no rows ships as a header-only CSV
        // rather than being left out. Omitting it made "nothing was
        // collected for this form" indistinguishable from a broken export --
        // a manifest declaring four forms would produce three files with
        // nothing to say which case it was.
        exportFiles[`${form.table_name}.csv`] = buildSubmissionsCsv(
            formSubmissions,
            form.versionByPackage,
            declaredColumns(form.allFields, { hasParent: !!form.parent_table }),
          );
      }

      // Export formchanges for this survey.
      //
      // formchanges carries no survey link of its own -- only record_uuid,
      // which is a submission's local_unique_id -- so the record ids have to
      // be gathered first, across every version, and under the same data
      // filter so the change log covers exactly the records exported.
      const surveySubmissions = versionIds.length === 0 ? [] : await fetchAllRows<{ local_unique_id: string }>((from, to) =>
        withDataStatus(
          supabase
            .from('submissions')
            .select('local_unique_id')
            .eq('project_id', projectId)
            .in('survey_package_id', versionIds),
          dataFilter,
        )
          .order('id')
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
              fetchAllRows<ExportFormChange>((from, to) =>
                supabase.from('formchanges').select('*').eq('project_id', projectId).in('record_uuid', chunk).order('id').range(from, to),
              ),
            ),
          )
        ).flat();

        if (formchanges.length > 0) {
          exportFiles['formchanges.csv'] = buildFormChangesCsv(formchanges);
        }
      }

      // Include a header even when no device changes exist. Server history
      // includes initial entries and is separate from the device event stream.
      exportFiles['formchanges.csv'] ??= buildFormChangesCsv([]);
      const audit = await fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase.from('system_audit_events').select('*').eq('project_id', projectId).order('id').range(from, to),
      );
      exportFiles['project_audit.csv'] = buildCsv(
        ['id', 'project_id', 'entity_type', 'entity_id', 'operation', 'occurred_at', 'actor_user_id', 'actor_database_role', 'uploader_username', 'old_values', 'new_values', 'reason'],
        audit.map(row => ['id', 'project_id', 'entity_type', 'entity_id', 'operation', 'occurred_at', 'actor_user_id', 'actor_database_role', 'uploader_username', 'old_values', 'new_values', 'reason'].map(key => row[key])),
      );
      const manifest = await buildExportManifest(exportFiles, {
        exportId: crypto.randomUUID(), createdAt: new Date().toISOString(), projectId,
        scope: `survey ${surveyCode}; ${exportScopeLabel(dataFilter)}; project_audit.csv covers the whole authorised project`,
      });
      const { error: auditError } = await supabase.rpc('record_data_export', {
        p_project_id: projectId, p_details: { ...manifest, data_status_filter: dataFilter, outcome: 'prepared' },
      });
      if (auditError) throw auditError;
      for (const [path, content] of Object.entries(exportFiles)) zip.file(path, content);
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      // Generate and download ZIP
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${survey.name}_data${exportFileSuffix(dataFilter)}_${format(new Date(), 'yyyy-MM-dd')}.zip`;
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
    setSelectedIds(new Set());
    // Removed searchTerm clear and scroll since search is gone and we use a dialog
  };

  // `fieldname` is optional on a SurveyQuestion, so a column built from one
  // can genuinely have none -- and a field with no name has no value to look
  // up. Same "-" as a null answer rather than the string "undefined".
  const getFieldValue = (data: Record<string, unknown>, fieldname: string | undefined) => {
    if (!fieldname) return '-';
    const value = data?.[fieldname];
    if (value === null || value === undefined) return '-';
    const str = String(value);
    return str.length > 30 ? str.substring(0, 30) + '...' : str;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">Data <HelpLink slug="data/browse" /></h2>
          <p className="text-sm text-muted-foreground">
            View and export collected data for this project
          </p>
        </div>
        <div className="space-y-1">
          <div role="radiogroup" aria-label="Which data to show" className="inline-flex rounded-md border p-0.5">
            {DATA_STATUS_FILTERS.map((filter) => (
              <Button
                key={filter}
                role="radio"
                aria-checked={dataFilter === filter}
                size="sm"
                variant={dataFilter === filter ? 'secondary' : 'ghost'}
                onClick={() => setDataFilter(filter)}
              >
                {DATA_STATUS_FILTER_LABELS[filter]}
                {surveysWithForms && (
                  <span
                    className={cn(
                      "ml-1.5 rounded px-1.5 text-xs tabular-nums",
                      dataFilter === filter
                        ? "bg-secondary-foreground/90 font-semibold text-secondary"
                        : "text-muted-foreground",
                    )}
                  >
                    {countFor(projectCounts, filter)}
                  </span>
                )}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-right">
            Labelled by the survey's status when each record reached the server
          </p>
        </div>
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
                      {plural(survey.forms.length, 'form')} • {plural(countFor(survey.totalRecords, dataFilter), dataFilter === 'all' ? 'record' : `${dataFilter} record`)}
                      {dataFilter === 'deployed' && survey.totalRecords.test > 0 && (
                        <> • {survey.totalRecords.test} test hidden</>
                      )}
                      {survey.versionCount > 1 && (
                        <> • {survey.versionCount} versions, merged</>
                      )}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handleExportSurvey(survey.id)}
                    disabled={countFor(survey.totalRecords, dataFilter) === 0 || exportingId === survey.id}
                  >
                    {exportingId === survey.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    {dataFilter === 'all' ? 'Export All' : `Export ${DATA_STATUS_FILTER_LABELS[dataFilter]}`}
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
                        <Badge variant={countFor(form.recordCounts, dataFilter) > 0 ? 'secondary' : 'outline'}>
                          {plural(countFor(form.recordCounts, dataFilter), 'record')}
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
                    : `${plural(filteredSubmissions.length, 'record')} • ${exportScopeLabel(dataFilter)}`}
                  {isOwner && selectedIds.size > 0 && ` • ${selectedIds.size} selected`}
                </DialogDescription>
              </div>
              <div className="flex gap-2 mr-8"> {/* mr-8 to avoid overlap with close button */}
                {isOwner && (
                  <Button
                    variant="outline"
                    onClick={openReclassify}
                    disabled={selectedIds.size === 0}
                    title="Mark the selected records as test or deployed"
                  >
                    <Tags className="h-4 w-4 mr-2" />
                    Reclassify…
                  </Button>
                )}
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
                        {isOwner && (
                          <TableHead className="w-[40px]">
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={toggleAll}
                              aria-label={`Select all ${filteredSubmissions.length} records`}
                              title={`Select all ${filteredSubmissions.length} records, on every page`}
                            />
                          </TableHead>
                        )}
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
                          {isOwner && (
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(submission.id)}
                                onCheckedChange={() => toggleOne(submission.id)}
                                aria-label={`Select record ${submission.local_unique_id}`}
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-mono text-xs">
                            <span className="inline-flex items-center gap-1.5">
                              {submission.local_unique_id?.substring(0, 8)}...
                              {submission.data_status === 'test' && (
                                <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] font-sans">
                                  <FlaskConical className="h-3 w-3" />
                                  Test
                                </Badge>
                              )}
                            </span>
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
                  {dataFilter === 'all'
                    ? 'No data collected yet for this form.'
                    : `No ${dataFilter} data for this form.`}
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
                <div>
                  <p className="text-sm font-medium">Data</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedRecord.data_status === 'test' ? 'Test' : 'Deployed'}
                  </p>
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
                    {selectedRecord.data && orderRecordEntries(selectedRecord.data, orderedColumnNames)
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
                  <FormChangesView recordUuid={selectedRecord.local_unique_id} submissionId={selectedRecord.id} />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reclassify Dialog */}
      <Dialog open={reclassifyOpen} onOpenChange={(open) => !reclassifying && setReclassifyOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reclassify {plural(selectedIds.size, 'record')}</DialogTitle>
            <DialogDescription>
              Records are labelled by the survey's status when they first reached the server. Use
              this to correct a label, for example test records a phone uploaded after the
              survey was deployed. Each change is recorded in the audit trail with your reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Mark as</Label>
              <div role="radiogroup" aria-label="New label" className="flex gap-2">
                {(['test', 'deployed'] as const).map((status) => (
                  <Button
                    key={status}
                    type="button"
                    role="radio"
                    aria-checked={reclassifyTarget === status}
                    variant={reclassifyTarget === status ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setReclassifyTarget(status)}
                  >
                    {DATA_STATUS_FILTER_LABELS[status]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reclassify-reason">Reason (required)</Label>
              <Textarea
                id="reclassify-reason"
                value={reclassifyReason}
                onChange={(e) => setReclassifyReason(e.target.value)}
                placeholder="e.g. Test interviews from tablet T-04, uploaded after deployment"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReclassifyOpen(false)} disabled={reclassifying}>
              Cancel
            </Button>
            <Button onClick={handleReclassify} disabled={reclassifying || !reclassifyReason.trim()}>
              {reclassifying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Mark {plural(selectedIds.size, 'record')} {reclassifyTarget}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectData;
