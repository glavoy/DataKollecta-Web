import { useEffect, useState } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  AlertDialogTrigger,
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
  Settings
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import JSZip from "jszip";
import { parseSurveyDocument } from "@/lib/xmlParser";
import { surveyService } from "@/services/surveyService";
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
import DuplicateSurveyDialog from "@/components/survey-designer/DuplicateSurveyDialog";

// Import project sub-components
import ProjectOverview from "@/components/project/ProjectOverview";
import ProjectData from "@/components/project/ProjectData";
import ProjectMembers from "@/components/project/ProjectMembers";
import ProjectFieldTeam from "@/components/project/ProjectFieldTeam";
import ProjectSettings from "@/components/project/ProjectSettings";

interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  is_active: boolean;
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
        surveysCount: surveysData?.length || 0,
        submissionsCount: submissionsCount || 0,
        formsCount: formsCount || 0,
        fieldTeamCount: fieldTeamCount || 0,
        membersCount: membersCount || 0,
      });

    } catch (error: any) {
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

    } catch (error: any) {
      console.error("Download error:", error);
      toast({
        title: "Download Failed",
        description: "Failed to download survey package.",
        variant: "destructive",
      });
    }
  };

  const handleTransitionStatus = async (survey: SurveyPackage, next: SurveyStatus) => {
    try {
      await surveyService.updateSurveyStatus(survey.id, next);
      toast({
        title: "Status updated",
        description: `"${survey.display_name}" is now ${STATUS_LABEL[next].toLowerCase()}.`,
      });
      setSurveyForTransition(null);
      fetchProjectData();
    } catch (error: any) {
      console.error("Status update error:", error);
      toast({
        title: "Could not update status",
        description: translateSurveyWriteError(error) ?? error.message ?? "An unexpected error occurred.",
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
    } catch (error: any) {
      console.error("Archive toggle error:", error);
      toast({
        title: "Could not update",
        description: error.message || "An unexpected error occurred.",
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
    } catch (error: any) {
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

      let manifestFile = null;
      loadedZip.forEach((relativePath, file) => {
        if (relativePath.toLowerCase().endsWith("survey_manifest.gistx")) {
          manifestFile = file;
        }
      });

      if (!manifestFile) {
        throw new Error("Invalid ZIP: survey_manifest.gistx is missing.");
      }

      // @ts-ignore
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

      // Use surveyId from manifest as the storage filename (consistent with surveyService.ts)
      const sanitizedSurveyId = surveyId.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
      const filePath = `${project.id}/${sanitizedSurveyId}.zip`;

      const { error: storageError } = await supabase.storage
        .from('surveys')
        .upload(filePath, uploadFile);

      if (storageError) throw storageError;

      // Insert new survey
      const { data: surveyData, error: dbError } = await supabase
        .from('survey_packages')
        .insert({
          project_id: project.id,
          name: surveyId,
          display_name: manifest.surveyName || surveyId,
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
        })
        .select()
        .single();

      if (dbError) throw dbError;

      const crfsToInsert = [];

      for (const crfEntry of manifest.crfs) {
        const xmlFileName = `${crfEntry.tablename}.xml`;
        let xmlFile = null;

        loadedZip.forEach((path, file) => {
          if (path.toLowerCase().endsWith(xmlFileName.toLowerCase())) {
            xmlFile = file;
          }
        });

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
            ? { ...crfEntry.idconfig, _formConfig: formConfig }
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

      toast({
        title: "Success",
        description: `Survey uploaded as a draft. ${crfsToInsert.length} form(s) processed. ` +
          `Promote it from the surveys list when it's ready.`,
      });

      setIsUploadOpen(false);
      setUploadFile(null);
      setUploadDescription(""); // Reset description
      fetchProjectData();

    } catch (error: any) {
      console.error('Upload error:', error);

      toast({
        title: "Upload Failed",
        description: translateSurveyWriteError(error) ?? error.message ?? "Failed to process survey package.",
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
                <Badge variant={project.is_active ? 'default' : 'secondary'}>
                  {project.is_active ? 'Active' : 'Inactive'}
                </Badge>
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
              onOpenUploadDialog={() => setIsUploadOpen(true)}
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
                            Upload & Publish
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
                      <TableHead>Version Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {surveys
                      .filter((survey) => {
                        if (archiveFilter === 'all') return true;
                        if (archiveFilter === 'archived') return !!survey.archived_at;
                        return !survey.archived_at;
                      })
                      .map((survey) => {
                      const sourceName = survey.copied_from
                        ? surveys.find(s => s.id === survey.copied_from)?.display_name
                        : null;
                      const legalNext = LEGAL_TRANSITIONS[survey.status] ?? [];

                      return (
                      <TableRow key={survey.id}>
                        <TableCell className="font-medium">
                          <div className="flex flex-col">
                            <span>{survey.display_name}</span>
                            <span className="text-xs text-muted-foreground">{survey.name}</span>
                            {sourceName && (
                              <span className="text-xs text-muted-foreground">Copied from {sourceName}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {new Date(survey.version_date).toLocaleDateString()}
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
                                  <DropdownMenuItem onClick={() => setSurveyToDuplicate(survey)}>
                                    <Copy className="h-4 w-4 mr-2" />
                                    Duplicate
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
                    })}
                  </TableBody>
                </Table>
              </Card>
              </>
            )}
          </TabsContent>

          {/* Data Tab */}
          <TabsContent value="data">
            <ProjectData projectId={project.id} projectName={project.name} />
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
                    make changes later you will duplicate it under a new Survey ID. Phones will
                    download it at their next login.
                    {surveyForTransition.survey.status === 'draft' && (
                      <> This survey has not been through Test.</>
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
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
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
