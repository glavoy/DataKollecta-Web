import { useEffect, useState } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft,
  Plus,
  Loader2,
  Edit2,
  Eye,
  FileCode,
  FileUp,
  Download,
  Trash2,
  Copy,
  Archive,
  ArchiveRestore,
  MoreVertical,
  LayoutDashboard,
  FileSpreadsheet,
  Database,
  Users,
  UserCog,
  Settings,
  GitBranch,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import JSZip from "jszip";
import { parseSurveyDocument } from "@/lib/xmlParser";
import { surveyService } from "@/services/surveyService";
import { groupByLineage, formatVersionLabel } from "@/lib/surveyVersion";
import { projectMemberService } from "@/services/projectMemberService";
import { fetchAllRows, chunkIds } from "@/lib/supabasePaging";
import {
  SurveyStatus,
  LEGAL_TRANSITIONS,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  ARCHIVED_BADGE_CLASS,
  isSurveyDeletable,
} from "@/lib/surveyStatus";
import { findSurveyIdConflict, surveyIdConflictMessage, translateSurveyWriteError } from "@/lib/errors/surveyErrors";
import { validatePackage } from "@/lib/validation";
import { ProjectStatus, STATUS_LABEL as PROJECT_STATUS_LABEL, STATUS_BADGE_CLASS as PROJECT_STATUS_BADGE_CLASS, ARCHIVED_BADGE_CLASS as PROJECT_ARCHIVED_BADGE_CLASS } from "@/lib/projectStatus";
import DuplicateSurveyDialog from "@/components/survey-designer/DuplicateSurveyDialog";

// Import project sub-components
import ProjectOverview from "@/components/project/ProjectOverview";
import ProjectData from "@/components/project/ProjectData";
import ProjectMembers from "@/components/project/ProjectMembers";
import ProjectFieldTeam from "@/components/project/ProjectFieldTeam";
import ProjectSettings from "@/components/project/ProjectSettings";
import { getErrorMessage } from "@/lib/errors/getErrorMessage";

interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: ProjectStatus;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
}

interface SurveyPackage {
  id: string;
  name: string;
  display_name: string;
  version_date: string;
  status: SurveyStatus;
  description: string;
  zip_file_path: string;
  created_at: string;
  archived_at: string | null;
  copied_from: string | null;
  survey_code: string;
  version: number;
}

/** The parts of an uploaded survey_manifest.gistx this page reads. Untrusted
 *  input -- everything is optional and validated before use. */
interface UploadedManifest {
  surveyId?: string;
  surveyName?: string;
  databaseName?: string;
  description?: string;
  crfs?: Record<string, unknown>[];
}

interface ProjectStats {
  surveysCount: number;
  submissionsCount: number;
  formsCount: number;
  fieldTeamCount: number;
  membersCount: number;
}

const ProjectDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [surveys, setSurveys] = useState<SurveyPackage[]>([]);
  const [stats, setStats] = useState<ProjectStats>({
    surveysCount: 0,
    submissionsCount: 0,
    formsCount: 0,
    fieldTeamCount: 0,
    membersCount: 0,
  });
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Get initial tab from URL or default to overview
  const tabFromUrl = searchParams.get('tab');
  const validTabs = ['overview', 'surveys', 'data', 'members', 'team', 'settings'];
  const initialTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);

  // Update URL when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'overview') {
      searchParams.delete('tab');
    } else {
      searchParams.set('tab', tab);
    }
    setSearchParams(searchParams);
  };

  // Upload State
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDescription, setUploadDescription] = useState("");

  // Delete Dialog State
  const [surveyToDelete, setSurveyToDelete] = useState<SurveyPackage | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  // Surveys tab: which surveys are visible, plus the two dialogs launched
  // from a survey's row menu.
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [surveyToDuplicate, setSurveyToDuplicate] = useState<SurveyPackage | null>(null);
  const [surveyForTransition, setSurveyForTransition] = useState<{ survey: SurveyPackage; next: SurveyStatus } | null>(null);
  // Older versions are collapsed under their latest by default -- a long-running
  // survey accumulates them, and the latest is what people act on.
  const [expandedLineages, setExpandedLineages] = useState<Set<string>>(new Set());
  const [creatingVersionFor, setCreatingVersionFor] = useState<string | null>(null);
  // Ticked in the deploy dialog to retire the currently-deployed version at the
  // same time. Unchecked by default: two versions deployed at once is a
  // supported state, not a mistake -- field teams in different regions start at
  // different times, and one may need to finish on the old version.
  const [retireSiblingOnDeploy, setRetireSiblingOnDeploy] = useState(false);
  // An upload held at the point of decision: its databaseName matches an
  // existing survey, so it can only be that survey's next version. Nothing has
  // been written yet, so cancelling here leaves no trace.
  const [pendingVersionUpload, setPendingVersionUpload] = useState<{
    manifest: UploadedManifest;
    surveyId: string;
    lineage: NonNullable<Awaited<ReturnType<typeof surveyService.findLineageByDatabaseName>>>;
  } | null>(null);
  // Archiving a survey that's still deployed doesn't stop phones downloading
  // it -- that's what "Complete" is for. Confirm before archiving one of
  // those, since it's easy to assume archiving hides it from devices too.
  const [archiveWarningSurvey, setArchiveWarningSurvey] = useState<SurveyPackage | null>(null);

  useEffect(() => {
    if (slug) {
      fetchProjectData();
    }
  }, [slug, user]);

  const fetchProjectData = async () => {
    if (!user || !slug) return;

    try {
      setLoading(true);

      // 1. Fetch project
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('slug', slug)
        .single();

      if (projectError) throw projectError;
      setProject(projectData);

      // 2. Fetch user role
      const role = await projectMemberService.getUserRole(projectData.id, user.id);
      setUserRole(role);

      // 3. Fetch Surveys (Survey Packages)
      const { data: surveysData, error: surveysError } = await supabase
        .from('survey_packages')
        .select('*')
        .eq('project_id', projectData.id)
        .order('version_date', { ascending: false });

      if (surveysError) throw surveysError;
      setSurveys(surveysData || []);

      // 4. Fetch stats
      // CRFs count
      const { count: formsCount } = await supabase
        .from('crfs')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectData.id);

      // Submissions count
      const { count: submissionsCount } = await supabase
        .from('submissions')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectData.id);

      // Field team count
      const { count: fieldTeamCount } = await supabase
        .from('app_credentials')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectData.id);

      // Members count
      const { count: membersCount } = await supabase
        .from('project_members')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectData.id);

      setStats({
        // Surveys, not survey versions -- the surveys list groups versions
        // under one entry, so counting rows here would disagree with what is
        // on screen the moment a survey has a second version.
        surveysCount: new Set((surveysData ?? []).map((s) => s.survey_code)).size,
        submissionsCount: submissionsCount || 0,
        formsCount: formsCount || 0,
        fieldTeamCount: fieldTeamCount || 0,
        membersCount: membersCount || 0,
      });

    } catch (error) {
      console.error('Error fetching project data:', error);
      toast({
        title: "Error",
        description: "Failed to load project details.",
        variant: "destructive",
      });
      navigate('/app/projects');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadSurvey = async (filePath: string, fileName: string) => {
    if (!filePath) {
      toast({
        title: "Error",
        description: "No file path available for this survey.",
        variant: "destructive",
      });
      return;
    }

    try {
      const signedUrl = await surveyService.getSurveyDownloadUrl(filePath);

      if (!signedUrl) {
        throw new Error("Could not generate download URL.");
      }

      const link = document.createElement('a');
      link.href = signedUrl;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();

      toast({
        title: "Download Started",
        description: "Your survey package is downloading.",
      });

    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Download Failed",
        description: "Failed to download survey package.",
        variant: "destructive",
      });
    }
  };

  /**
   * The OTHER versions of this survey that are currently deployed. Used to
   * offer -- never to force -- retiring them when a new version goes live.
   */
  const deployedSiblings = (survey: SurveyPackage) =>
    surveys.filter(
      (s) => s.survey_code === survey.survey_code && s.id !== survey.id && s.status === 'deployed'
    );

  /**
   * Starts the next version of a survey: a fresh editable draft that belongs to
   * the same survey and collects into the same dataset. This is the path for
   * revising a deployed survey -- Duplicate, by contrast, forks a separate
   * study with its own database and its own data.
   *
   * No dialog: unlike a duplicate, there is nothing to choose. The Survey ID is
   * minted from the lineage and the database name is inherited, precisely so
   * the data stays together.
   */
  const handleCreateVersion = async (survey: SurveyPackage) => {
    if (!project || !user?.id) return;
    try {
      setCreatingVersionFor(survey.id);
      const saved = await surveyService.createSurveyVersion({
        sourceId: survey.id,
        projectId: project.id,
        userId: user.id,
      });
      toast({
        title: `Version ${saved.version} created`,
        description: `A draft copy of "${survey.display_name}" is ready to edit. It collects ` +
          `into the same data as the earlier versions.`,
      });
      navigate(`/app/projects/${project.slug}/surveys/${saved.id}`);
    } catch (error: unknown) {
      console.error("Create version error:", error);
      toast({
        title: "Could not create a new version",
        description:
          translateSurveyWriteError(error) ??
          (error instanceof Error ? error.message : null) ??
          "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setCreatingVersionFor(null);
    }
  };

  const handleTransitionStatus = async (survey: SurveyPackage, next: SurveyStatus) => {
    try {
      // The designer's own Save/Publish button blocks a status move to
      // test/deployed on validation errors -- this list-level action is
      // the only other way a survey's status changes, and until now it
      // bypassed that gate entirely. Loading the full package (rather than
      // a lighter-weight assembly) is deliberate: pkg.csvFiles, which the
      // dynamicCsvMissing rule checks against, is only ever populated by
      // getSurveyPackage's zip download/unzip step -- skipping it would
      // make every CSV-backed survey fail validation on every promotion.
      if (next === 'test' || next === 'deployed') {
        const { pkg } = await surveyService.getSurveyPackage(survey.id);
        const report = validatePackage(pkg);
        if (report.hasErrors) {
          toast({
            title: "Cannot publish",
            description: `${report.errorCount} error${report.errorCount === 1 ? '' : 's'} must be ` +
              `fixed first. Open the survey in the designer to review them.`,
            variant: "destructive",
          });
          return;
        }
      }

      await surveyService.updateSurveyStatus(survey.id, next);

      // Retiring the previous version is an OPTION, never automatic. Two
      // versions of one survey being deployed at once is legitimate -- teams
      // in different regions run to different timelines -- so this only fires
      // when the box in the deploy dialog was ticked.
      const retired: string[] = [];
      if (next === 'deployed' && retireSiblingOnDeploy) {
        for (const sibling of deployedSiblings(survey)) {
          await surveyService.updateSurveyStatus(sibling.id, 'complete');
          retired.push(`v${sibling.version}`);
        }
      }

      toast({
        title: "Status updated",
        description: `"${survey.display_name}" v${survey.version} is now ` +
          `${STATUS_LABEL[next].toLowerCase()}.` +
          (retired.length > 0 ? ` ${retired.join(', ')} moved to complete.` : ''),
      });
      setSurveyForTransition(null);
      setRetireSiblingOnDeploy(false);
      fetchProjectData();
    } catch (error) {
      console.error("Status update error:", error);
      toast({
        title: "Could not update status",
        description: translateSurveyWriteError(error) ?? getErrorMessage(error, "An unexpected error occurred."),
        variant: "destructive",
      });
    }
  };

  const handleArchiveClick = (survey: SurveyPackage) => {
    if (!survey.archived_at && survey.status === 'deployed') {
      setArchiveWarningSurvey(survey);
      return;
    }
    handleToggleArchived(survey);
  };

  const handleToggleArchived = async (survey: SurveyPackage) => {
    try {
      await surveyService.setSurveyArchived(survey.id, !survey.archived_at);
      toast({
        title: survey.archived_at ? "Survey unarchived" : "Survey archived",
        description: survey.archived_at
          ? `"${survey.display_name}" is back in the default list.`
          : `"${survey.display_name}" is hidden from the default list. Data, downloads, and Duplicate are unaffected.`,
      });
      fetchProjectData();
    } catch (error) {
      console.error("Archive toggle error:", error);
      toast({
        title: "Could not update",
        description: getErrorMessage(error, "An unexpected error occurred."),
        variant: "destructive",
      });
    }
  };

  const handleDeleteSurvey = async (surveyId: string) => {
    try {
      const surveyToDelete = surveys.find(s => s.id === surveyId);

      // Refuse BEFORE touching anything. The DB guard triggers only cover
      // the crfs and survey_packages tables -- this function deletes the
      // storage zip and every submission/formchange for the survey FIRST,
      // several steps before it ever reaches a guarded table. Without this
      // preflight, attempting to delete a locked survey would destroy its
      // zip and all field data, and only THEN get stopped by the trigger on
      // crfs -- leaving a "deployed" row with no zip and no submissions.
      if (surveyToDelete && !isSurveyDeletable(surveyToDelete.status)) {
        toast({
          title: "Cannot delete",
          description: `"${surveyToDelete.display_name}" is ${surveyToDelete.status} and cannot ` +
            `be deleted. Archive it instead if you want it out of the way.`,
          variant: "destructive",
        });
        return;
      }

      // Delete the zip file from storage first
      if (surveyToDelete && surveyToDelete.zip_file_path) {
        const { error: storageError } = await supabase.storage
          .from('surveys')
          .remove([surveyToDelete.zip_file_path]);

        if (storageError) {
          console.error("Error deleting file from storage:", storageError);
          // Don't throw - continue with database deletion even if storage fails
          // The file might already be deleted or not exist
        }
      }

      // Delete dependent Submissions and History. The submissions delete
      // below isn't row-capped (a DELETE with no representation isn't
      // subject to PostgREST's max_rows response cap), but this SELECT is
      // -- so it must be paged, or a survey with more than 1000 submissions
      // only has the first 1000 records' formchanges cleaned up, leaving
      // the rest to later brick project deletion (formchanges has no
      // ON DELETE CASCADE from projects).
      const submissionsData = await fetchAllRows<{ id: string; local_unique_id: string | null }>(
        (from, to) =>
          supabase
            .from('submissions')
            .select('id, local_unique_id')
            .eq('survey_package_id', surveyId)
            .range(from, to),
      );

      if (submissionsData.length > 0) {
        const recordUuids = submissionsData
          .map(s => s.local_unique_id)
          .filter((id): id is string => id !== null);

        if (recordUuids.length > 0) {
          // Chunked -- 1000+ UUIDs in one .in() exceeds a GET querystring's
          // practical length ceiling and fails as a 414.
          for (const chunk of chunkIds(recordUuids)) {
            await supabase.from('formchanges').delete().in('record_uuid', chunk);
          }
        }

        await supabase
          .from('submissions')
          .delete()
          .eq('survey_package_id', surveyId);
      }

      // Delete CRFs
      await supabase
        .from('crfs')
        .delete()
        .eq('survey_package_id', surveyId);

      // Delete Survey Package
      const { error } = await supabase
        .from('survey_packages')
        .delete()
        .eq('id', surveyId);

      if (error) throw error;

      toast({
        title: "Survey deleted",
        description: "The survey package and its file have been removed.",
      });

      setSurveyToDelete(null);
      setDeleteConfirmation("");
      fetchProjectData();
    } catch (error) {
      console.error("Delete error:", error);
      toast({
        title: "Error",
        description: "Failed to delete survey.",
        variant: "destructive",
      });
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !project) return;

    try {
      setUploading(true);

      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(uploadFile);

      // A direct lookup rather than a forEach that mutates a variable.
      // TypeScript cannot see that a callback ran, so under strict the
      // variable stayed narrowed to `null` and the later `.async("string")`
      // resolved against `never`. `JSZipObject.name` is the same relative
      // path forEach hands out.
      const manifestFile = Object.values(loadedZip.files).find((file) =>
        file.name.toLowerCase().endsWith("survey_manifest.gistx")
      );

      if (!manifestFile) {
        throw new Error("Invalid ZIP: survey_manifest.gistx is missing.");
      }

      const manifestContent = await manifestFile.async("string");
      const manifest = JSON.parse(manifestContent);

      if (!manifest.crfs || !Array.isArray(manifest.crfs) || manifest.crfs.length === 0) {
        throw new Error("Invalid Manifest: 'crfs' array is missing or empty.");
      }

      // Get surveyId from manifest (this is the unique identifier)
      const surveyId = manifest.surveyId;
      if (!surveyId) {
        throw new Error("Invalid Manifest: 'surveyId' is required.");
      }

      // Check if survey already exists - REJECT if it does. Covers both
      // unique indexes on survey_packages (project-scoped AND the global
      // per-account one), not just the project-scoped case this used to
      // check -- see findSurveyIdConflict's doc comment.
      if (user?.id) {
        const conflict = await findSurveyIdConflict(surveyId, project.id, user.id);
        if (conflict) {
          throw new Error(surveyIdConflictMessage(conflict));
        }
      }

      // Which survey is this a version OF?
      //
      // Matched on the manifest's databaseName alone -- never on a naming
      // convention and never on surveyId -- because databaseName is the thing
      // that actually decides data continuity on the device: DbService opens
      // one SQLite file per databaseName, so two packages declaring the same
      // one ARE the same dataset whatever they are called.
      //
      // A match is a determination, not a menu: the package will be added as
      // that survey's next version, and there is deliberately no "import as a
      // separate survey" option -- a shared databaseName means a shared file
      // on every phone, and enforce_survey_database_binding refuses the
      // alternative at the database anyway.
      //
      // The user can still CANCEL, which is a different thing: it abandons
      // the upload entirely and writes nothing. That is the out for the case
      // this is most likely to catch -- a designer who meant to author a new
      // study but reused an existing databaseName in their SurveyGen
      // config.json. They fix the config and upload again; nothing has been
      // touched in the meantime, which is why this decision happens BEFORE
      // the storage upload (that upload is upsert:true and cannot be undone).
      const lineage = manifest.databaseName
        ? await surveyService.findLineageByDatabaseName(project.id, manifest.databaseName)
        : null;

      if (lineage) {
        setPendingVersionUpload({ manifest, surveyId, lineage });
        setUploading(false);
        return;
      }

      await performSurveyUpload(manifest, surveyId, null);
    } catch (error: unknown) {
      console.error('Upload error:', error);
      toast({
        title: "Upload Failed",
        description:
          translateSurveyWriteError(error) ??
          (error instanceof Error ? error.message : null) ??
          "Failed to process survey package.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  /**
   * The write half of an upload, run once the survey it belongs to is settled.
   * `lineage` non-null means the package joins an existing survey as its next
   * version; null means it starts one.
   */
  const performSurveyUpload = async (
    manifest: UploadedManifest,
    surveyId: string,
    lineage: Awaited<ReturnType<typeof surveyService.findLineageByDatabaseName>>
  ) => {
    if (!uploadFile || !project) return;

    try {
      setUploading(true);
      const surveyCode = lineage?.surveyCode ?? surveyId;
      const version = lineage?.nextVersion ?? 1;

      // Re-read the zip rather than carrying the parsed handle across the
      // confirmation step -- the two halves stay independent, and the file in
      // state is the same one either way.
      const loadedZip = await new JSZip().loadAsync(uploadFile);

      // Use surveyId from manifest as the storage filename (consistent with surveyService.ts)
      const sanitizedSurveyId = surveyId.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
      const filePath = `${project.id}/${sanitizedSurveyId}.zip`;

      // upsert: true so a retry after a failed insert (DB error, crf error,
      // etc.) overwrites the orphaned object from the earlier attempt
      // instead of failing with "resource already exists" and leaving the
      // upload permanently stuck.
      const { error: storageError } = await supabase.storage
        .from('surveys')
        .upload(filePath, uploadFile, { upsert: true });

      if (storageError) throw storageError;

      // Insert new survey
      const { data: surveyData, error: dbError } = await supabase
        .from('survey_packages')
        .insert({
          project_id: project.id,
          // The manifest's surveyId verbatim, even for a version. It is
          // already the zip filename and the folder the app extracts into,
          // and db_service.dart resolves a survey's XML at
          // `surveys/<surveyId>/<file>` -- rewriting it to `code_vN` would
          // break that invariant on every device. `name` only has to be
          // unique; `version` is what orders the lineage.
          name: surveyId,
          // The manifest's own surveyName, NOT the lineage's -- the app lists
          // surveyNames and stores the active survey as one, so a version
          // that reused the earlier version's name would be indistinguishable
          // on the phone. SurveyGen's convention already carries the revision
          // in this field.
          display_name: manifest.surveyName || surveyId,
          survey_code: surveyCode,
          version: version,
          version_date: new Date().toISOString(),
          description: uploadDescription || manifest.description || "",
          zip_file_path: filePath,
          manifest: manifest,
          // Uploaded packages land as a draft rather than going straight to
          // phones -- promote deliberately from the surveys list once
          // reviewed. (Previously hardcoded 'active', with published_at set
          // alongside it; both removed.)
          status: 'draft',
          created_by: user?.id,
          copied_from: lineage?.latestId ?? null,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      const crfsToInsert: Record<string, unknown>[] = [];

      // `crfs` is optional on UploadedManifest, and the check that it is
      // present and non-empty happens in the caller -- which is a different
      // function, so nothing here guaranteed it. This is the exact shape H3
      // predicted `strictNullChecks` would surface: a manifest that failed to
      // parse typechecked fine and threw at runtime.
      for (const crfEntry of manifest.crfs ?? []) {
        const xmlFileName = `${crfEntry.tablename}.xml`;
        const xmlFile = Object.values(loadedZip.files).find((file) =>
          file.name.toLowerCase().endsWith(xmlFileName.toLowerCase())
        );

        if (!xmlFile) {
          console.warn(`XML file ${xmlFileName} not found in ZIP.`);
          continue;
        }

        const xmlContent = await xmlFile.async("string");
        // Reserved system variables and the end screen are stripped here; they
        // are re-added at generation time, so an imported package can be saved
        // and re-exported without accumulating duplicates.
        const { questions, endText } = parseSurveyDocument(xmlContent);

        // Store additional form config in id_config._formConfig for retrieval
        const formConfig = {
          incrementField: crfEntry.incrementfield,
          repeatCountField: crfEntry.repeat_count_field,
          entry_condition: crfEntry.entry_condition,
          endOfQuestionsText: endText,
        };

        crfsToInsert.push({
          survey_package_id: surveyData.id,
          project_id: project.id,
          table_name: crfEntry.tablename,
          display_name: crfEntry.displayname,
          display_order: crfEntry.display_order || 0,
          is_base: crfEntry.isbase === 1,
          primary_key: crfEntry.primarykey || null,
          linking_field: crfEntry.linkingfield || null,
          parent_table: crfEntry.parenttable || null,
          id_config: crfEntry.idconfig
            ? { ...(crfEntry.idconfig as Record<string, unknown>), _formConfig: formConfig }
            : { _formConfig: formConfig },
          display_fields: crfEntry.display_fields || null,
          auto_start_repeat: crfEntry.auto_start_repeat || 0,
          repeat_enforce_count: crfEntry.repeat_enforce_count || 1,
          fields: questions
        });
      }

      if (crfsToInsert.length > 0) {
        const { error: crfError } = await supabase
          .from('crfs')
          .insert(crfsToInsert);

        if (crfError) throw crfError;
      }

      // Say plainly when a package joined an existing survey rather than
      // creating a new one. The user was not asked, so they have to be told --
      // and told the one thing that would change the outcome (a different
      // databaseName in the package's own SurveyGen config.json).
      toast({
        title: lineage ? `Added as version ${version}` : "Success",
        description: lineage
          ? `This package declares the same database as "${lineage.displayName}", so it was ` +
            `added as version ${version} of that survey and will collect into the same data. ` +
            `${crfsToInsert.length} form(s) processed. To make it a separate survey instead, ` +
            `give it a different databaseName in its SurveyGen config.json and upload again.`
          : `Survey uploaded as a draft. ${crfsToInsert.length} form(s) processed. ` +
            `Promote it from the surveys list when it's ready.`,
      });

      setIsUploadOpen(false);
      setUploadFile(null);
      setUploadDescription(""); // Reset description
      setPendingVersionUpload(null);
      fetchProjectData();

    } catch (error: unknown) {
      console.error('Upload error:', error);

      toast({
        title: "Upload Failed",
        description:
          translateSurveyWriteError(error) ??
          (error instanceof Error ? error.message : null) ??
          "Failed to process survey package.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const canEdit = userRole === 'owner' || userRole === 'editor';

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!project) {
    return null;
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header with Back Button */}
        <div className="space-y-4">
          <Link to="/app/projects">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Projects
            </Button>
          </Link>

          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold text-foreground">{project.name}</h1>
                <Badge className={PROJECT_STATUS_BADGE_CLASS[project.status]}>
                  {PROJECT_STATUS_LABEL[project.status]}
                </Badge>
                {project.archived_at && (
                  <Badge variant="outline" className={PROJECT_ARCHIVED_BADGE_CLASS}>
                    Archived
                  </Badge>
                )}
                {userRole && (
                  <Badge variant="outline">{userRole}</Badge>
                )}
              </div>
              <p className="text-muted-foreground">{project.description}</p>
              <p className="text-sm text-muted-foreground">
                Project Code: <code className="bg-muted px-1 rounded">{project.slug}</code>
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="grid w-full grid-cols-6 lg:w-auto lg:inline-grid">
            <TabsTrigger value="overview" className="gap-2">
              <LayoutDashboard className="h-4 w-4 hidden sm:block" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="surveys" className="gap-2">
              <FileSpreadsheet className="h-4 w-4 hidden sm:block" />
              Surveys
            </TabsTrigger>
            <TabsTrigger value="data" className="gap-2">
              <Database className="h-4 w-4 hidden sm:block" />
              Data
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-2">
              <Users className="h-4 w-4 hidden sm:block" />
              Members
            </TabsTrigger>
            <TabsTrigger value="team" className="gap-2">
              <UserCog className="h-4 w-4 hidden sm:block" />
              Field Team
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="h-4 w-4 hidden sm:block" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview">
            <ProjectOverview
              project={project}
              stats={stats}
              onTabChange={handleTabChange}
            />
          </TabsContent>

          {/* Surveys Tab */}
          <TabsContent value="surveys" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Surveys</h2>
                <p className="text-sm text-muted-foreground">Manage your survey versions and forms</p>
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline">
                        <FileUp className="mr-2 h-4 w-4" />
                        Upload ZIP
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Upload Survey Package</DialogTitle>
                        <DialogDescription>
                          Upload a completed survey package (ZIP) containing survey_manifest.gistx and XML forms.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleFileUpload}>
                        <div className="grid gap-4 py-4">
                          <div className="grid gap-2">
                            <Label htmlFor="file">Survey ZIP File</Label>
                            <Input
                              id="file"
                              type="file"
                              accept=".zip"
                              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                            />
                            <p className="text-sm text-muted-foreground">
                              The zip filename will be used as the unique Survey ID.
                            </p>
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="description">Description</Label>
                            <Input
                              id="description"
                              placeholder="e.g. Initial draft for field test"
                              value={uploadDescription}
                              onChange={(e) => setUploadDescription(e.target.value)}
                            />
                          </div>
                        </div>
                        <DialogFooter className="flex justify-between gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setIsUploadOpen(false);
                              setUploadFile(null);
                              setUploadDescription("");
                            }}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" disabled={uploading || !uploadFile}>
                            {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Upload
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>

                  <Button onClick={() => navigate(`/app/projects/${project.slug}/surveys/new`)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create New Survey
                  </Button>
                </div>
              )}
            </div>

            {surveys.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-10 space-y-4">
                  <div className="p-4 bg-muted rounded-full">
                    <FileCode className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <h3 className="font-semibold text-lg">No surveys yet</h3>
                    <p className="text-muted-foreground text-sm max-w-sm">
                      Create a new survey using the designer or upload an existing package.
                    </p>
                  </div>
                  {canEdit && (
                    <Button onClick={() => navigate(`/app/projects/${project.slug}/surveys/new`)}>
                      Create First Survey
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                {(() => {
                  const archivedCount = surveys.filter(s => s.archived_at).length;
                  return (
                    <div className="flex items-center justify-end mb-3">
                      <Select value={archiveFilter} onValueChange={(v) => setArchiveFilter(v as typeof archiveFilter)}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="archived">Archived ({archivedCount})</SelectItem>
                          <SelectItem value="all">All</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })()}
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Survey Name</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupByLineage(
                      surveys.filter((survey) => {
                        if (archiveFilter === 'all') return true;
                        if (archiveFilter === 'archived') return !!survey.archived_at;
                        return !survey.archived_at;
                      })
                    ).flatMap((lineage) => {
                      const hasHistory = lineage.versions.length > 1;
                      const expanded = expandedLineages.has(lineage.surveyCode);
                      // Older versions stay collapsed until asked for; the
                      // latest is what people act on.
                      const shown = expanded ? lineage.versions : [lineage.latest];
                      const deployedCount = lineage.versions.filter((v) => v.status === 'deployed').length;

                      return shown.map((survey) => {
                      const isLatest = survey.id === lineage.latest.id;
                      // "Copied from" is about FORKS. A version's copied_from
                      // points at its own predecessor, which the lineage
                      // grouping already shows -- repeating it as provenance
                      // would just be noise.
                      const source = survey.copied_from
                        ? surveys.find(s => s.id === survey.copied_from)
                        : null;
                      const sourceName =
                        source && source.survey_code !== survey.survey_code ? source.display_name : null;
                      const legalNext = LEGAL_TRANSITIONS[survey.status] ?? [];

                      return (
                      <TableRow key={survey.id} className={isLatest ? undefined : 'bg-muted/30'}>
                        <TableCell className="font-medium">
                          <div className={`flex flex-col ${isLatest ? '' : 'pl-6'}`}>
                            <span className="flex items-center gap-1.5">
                              {isLatest && hasHistory && (
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground"
                                  aria-expanded={expanded}
                                  aria-label={expanded
                                    ? `Hide earlier versions of ${survey.display_name}`
                                    : `Show ${lineage.versions.length - 1} earlier version(s) of ${survey.display_name}`}
                                  onClick={() => setExpandedLineages((prev) => {
                                    const nextSet = new Set(prev);
                                    if (nextSet.has(lineage.surveyCode)) nextSet.delete(lineage.surveyCode);
                                    else nextSet.add(lineage.surveyCode);
                                    return nextSet;
                                  })}
                                >
                                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </button>
                              )}
                              {survey.display_name}
                            </span>
                            <span className="text-xs text-muted-foreground">{survey.name}</span>
                            {isLatest && hasHistory && !expanded && (
                              <span className="text-xs text-muted-foreground">
                                {lineage.versions.length} versions, one dataset
                              </span>
                            )}
                            {sourceName && (
                              <span className="text-xs text-muted-foreground">Copied from {sourceName}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {formatVersionLabel(survey.version, survey.version_date)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Badge className={STATUS_BADGE_CLASS[survey.status]}>
                              {STATUS_LABEL[survey.status]}
                            </Badge>
                            {survey.archived_at && (
                              <Badge variant="outline" className={ARCHIVED_BADGE_CLASS}>
                                Archived
                              </Badge>
                            )}
                            {survey.status === 'deployed' && deployedCount > 1 && (
                              <Badge
                                variant="outline"
                                className="text-xs flex-shrink-0"
                                title={`${deployedCount} versions of this survey are deployed at once. ` +
                                  `This is allowed -- teams on different timelines can run different versions.`}
                              >
                                {deployedCount} live
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title={isSurveyDeletable(survey.status) ? "Edit" : "View"}
                                onClick={() => navigate(`/app/projects/${project.slug}/surveys/${survey.id}`)}
                              >
                                {isSurveyDeletable(survey.status) ? <Edit2 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Download"
                              onClick={() => handleDownloadSurvey(survey.zip_file_path, `${survey.name}.zip`)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            {canEdit && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" title="More actions">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    disabled={creatingVersionFor === survey.id}
                                    onClick={() => handleCreateVersion(survey)}
                                  >
                                    <GitBranch className="h-4 w-4 mr-2" />
                                    New Version
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setSurveyToDuplicate(survey)}>
                                    <Copy className="h-4 w-4 mr-2" />
                                    Duplicate as new survey
                                  </DropdownMenuItem>
                                  {legalNext.length > 0 && <DropdownMenuSeparator />}
                                  {legalNext.map((next) => (
                                    <DropdownMenuItem
                                      key={next}
                                      onClick={() => setSurveyForTransition({ survey, next })}
                                    >
                                      Move to {STATUS_LABEL[next]}
                                    </DropdownMenuItem>
                                  ))}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => handleArchiveClick(survey)}>
                                    {survey.archived_at ? (
                                      <>
                                        <ArchiveRestore className="h-4 w-4 mr-2" />
                                        Unarchive
                                      </>
                                    ) : (
                                      <>
                                        <Archive className="h-4 w-4 mr-2" />
                                        Archive
                                      </>
                                    )}
                                  </DropdownMenuItem>
                                  {isSurveyDeletable(survey.status) && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={() => {
                                          setSurveyToDelete(survey);
                                          setDeleteConfirmation("");
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                      });
                    })}
                  </TableBody>
                </Table>
              </Card>
              </>
            )}
          </TabsContent>

          {/* Data Tab */}
          <TabsContent value="data">
            <ProjectData projectId={project.id} />
          </TabsContent>

          {/* Members Tab */}
          <TabsContent value="members">
            <ProjectMembers
              projectId={project.id}
              projectName={project.name}
              userRole={userRole}
              onMemberChange={fetchProjectData}
            />
          </TabsContent>

          {/* Field Team Tab */}
          <TabsContent value="team">
            <ProjectFieldTeam
              projectId={project.id}
              projectName={project.slug}
              userRole={userRole}
            />
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <ProjectSettings
              project={project}
              userRole={userRole}
              onProjectUpdate={fetchProjectData}
              hasDeployedSurveys={surveys.some(s => s.status === 'deployed')}
            />
          </TabsContent>
        </Tabs >

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!surveyToDelete} onOpenChange={(open) => !open && setSurveyToDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Survey?</DialogTitle>
              <DialogDescription>
                This will permanently delete the survey version <span className="font-bold text-foreground">{surveyToDelete?.display_name}</span> ({surveyToDelete?.name}) and all its forms.
                <br /><br />
                <span className="text-destructive font-semibold">Warning: All data collected for this version will also be deleted.</span>
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="confirm-delete">
                Type <span className="font-bold text-foreground">{surveyToDelete?.name}</span> to confirm:
              </Label>
              <Input
                id="confirm-delete"
                placeholder={surveyToDelete?.name}
                className="mt-2"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setSurveyToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleteConfirmation !== surveyToDelete?.name}
                onClick={() => surveyToDelete && handleDeleteSurvey(surveyToDelete.id)}
              >
                Delete Survey
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Upload joins an existing survey as its next version */}
        <AlertDialog
          open={!!pendingVersionUpload}
          onOpenChange={(open) => !open && setPendingVersionUpload(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Add as version {pendingVersionUpload?.lineage.nextVersion} of "
                {pendingVersionUpload?.lineage.displayName}"?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    This package declares database{' '}
                    <code>{pendingVersionUpload?.manifest?.databaseName}</code>, which "
                    {pendingVersionUpload?.lineage.displayName}" already uses. On a phone that
                    is one file, so this package collects into the same data as that survey's{' '}
                    {pendingVersionUpload?.lineage.versions.length} existing version
                    {pendingVersionUpload?.lineage.versions.length === 1 ? '' : 's'}.
                  </p>
                  <p>
                    <strong>If you meant to create a separate survey</strong>, cancel: nothing
                    has been uploaded yet. Give it a different <code>databaseName</code> in its
                    SurveyGen <code>config.json</code>, regenerate the package and upload again.
                    Two surveys cannot share one database -- they would write into the same file
                    on the device, mixing their records and their ID counters.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel upload</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const pending = pendingVersionUpload;
                  if (!pending) return;
                  setPendingVersionUpload(null);
                  performSurveyUpload(pending.manifest, pending.surveyId, pending.lineage);
                }}
              >
                Add as version {pendingVersionUpload?.lineage.nextVersion}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Status transition confirmation */}
        <AlertDialog open={!!surveyForTransition} onOpenChange={(open) => !open && setSurveyForTransition(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Move "{surveyForTransition?.survey.display_name}" to {surveyForTransition ? STATUS_LABEL[surveyForTransition.next] : ''}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {surveyForTransition?.next === 'deployed' && (
                  <>
                    Deploying locks this survey -- its questions can never be changed again. To
                    make changes later, use New Version: the revision keeps the same database, so
                    its data joins this one rather than starting a second dataset. Phones will
                    download it at their next login.
                    {surveyForTransition.survey.status === 'draft' && (
                      <> This survey has not been through Test.</>
                    )}
                    {deployedSiblings(surveyForTransition.survey).length > 0 && (
                      <>
                        {' '}
                        <strong>
                          {deployedSiblings(surveyForTransition.survey)
                            .map((v) => `v${v.version}`)
                            .join(', ')}{' '}
                          {deployedSiblings(surveyForTransition.survey).length === 1 ? 'is' : 'are'} already
                          deployed
                        </strong>
                        , so both will be offered to phones. That is fine if teams are on different
                        timelines -- their data goes to the same place either way.
                      </>
                    )}
                  </>
                )}
                {surveyForTransition?.next === 'complete' && (
                  <>Phones will stop downloading this survey. Its data is retained and it can be moved back to Deployed later if collection needs to reopen.</>
                )}
                {surveyForTransition?.next === 'draft' && (
                  <>This makes the survey editable again.</>
                )}
                {surveyForTransition?.next === 'test' && (
                  <>This survey will become downloadable to phones, marked as a test package.</>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {surveyForTransition?.next === 'deployed' &&
              deployedSiblings(surveyForTransition.survey).length > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={retireSiblingOnDeploy}
                    onChange={(e) => setRetireSiblingOnDeploy(e.target.checked)}
                  />
                  <span>
                    Also move{' '}
                    {deployedSiblings(surveyForTransition.survey)
                      .map((v) => `v${v.version}`)
                      .join(', ')}{' '}
                    to Complete. Phones stop being offered{' '}
                    {deployedSiblings(surveyForTransition.survey).length === 1 ? 'it' : 'them'}; devices
                    that already have{' '}
                    {deployedSiblings(surveyForTransition.survey).length === 1 ? 'it' : 'them'} keep
                    collecting and syncing.
                  </span>
                </label>
              )}
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setRetireSiblingOnDeploy(false)}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => surveyForTransition && handleTransitionStatus(surveyForTransition.survey, surveyForTransition.next)}
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Archive-while-deployed warning */}
        <AlertDialog open={!!archiveWarningSurvey} onOpenChange={(open) => !open && setArchiveWarningSurvey(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive a deployed survey?</AlertDialogTitle>
              <AlertDialogDescription>
                "{archiveWarningSurvey?.display_name}" is still deployed. Archiving only hides it
                from this list -- phones will keep downloading it. If you want to stop collection,
                move it to Complete instead (from the row menu).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (archiveWarningSurvey) handleToggleArchived(archiveWarningSurvey);
                  setArchiveWarningSurvey(null);
                }}
              >
                Archive anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {surveyToDuplicate && project && (
          <DuplicateSurveyDialog
            open={!!surveyToDuplicate}
            onOpenChange={(open) => !open && setSurveyToDuplicate(null)}
            source={{
              id: surveyToDuplicate.id,
              surveyId: surveyToDuplicate.name,
              displayName: surveyToDuplicate.display_name,
            }}
            projectId={project.id}
            userId={user?.id}
            projectSlug={project.slug}
          />
        )}
      </div >
    </AppLayout >
  );
};

export default ProjectDetail;
