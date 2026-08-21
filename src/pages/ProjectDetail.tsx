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
  ArrowLeft,
  Plus,
  Loader2,
  Edit2,
  FileCode,
  FileUp,
  Download,
  Trash2,
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
  status: string;
  description: string;
  zip_file_path: string;
  created_at: string;
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

  const handleDeleteSurvey = async (surveyId: string) => {
    try {
      const surveyToDelete = surveys.find(s => s.id === surveyId);

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

      // Delete dependent Submissions and History
      const { data: submissionsData } = await supabase
        .from('submissions')
        .select('id, local_unique_id')
        .eq('survey_package_id', surveyId);

      if (submissionsData && submissionsData.length > 0) {
        const recordUuids = submissionsData
          .map(s => s.local_unique_id)
          .filter(id => id !== null);

        if (recordUuids.length > 0) {
          await supabase
            .from('formchanges')
            .delete()
            .in('record_uuid', recordUuids);
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

      // Check if survey already exists - REJECT if it does
      const { data: existingSurvey } = await supabase
        .from('survey_packages')
        .select('id, display_name')
        .eq('project_id', project.id)
        .eq('name', surveyId)
        .maybeSingle();

      if (existingSurvey) {
        throw new Error(
          `A survey with ID "${surveyId}" already exists in this project. ` +
          `Please delete the existing survey "${existingSurvey.display_name}" first, or use a different Survey ID in the manifest.`
        );
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
          status: 'active',
          created_by: user?.id,
          published_at: new Date().toISOString()
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
        description: `Survey uploaded and published. ${crfsToInsert.length} form(s) processed.`,
      });

      setIsUploadOpen(false);
      setUploadFile(null);
      setUploadDescription(""); // Reset description
      fetchProjectData();

    } catch (error: any) {
      console.error('Upload error:', error);

      let errorMessage = error.message || "Failed to process survey package.";

      // Handle unique constraint violations for survey ID
      if (error.code === '23505') {
        if (
          error.message?.includes('survey_packages_name_created_by_idx') ||
          error.details?.includes('survey_packages_name_created_by_idx') ||
          JSON.stringify(error).includes('survey_packages_name_created_by_idx')
        ) {
          errorMessage = "You already have a survey with this ID (Survey Name). Please verify that the 'surveyId' in your manifest is unique.";
        }
      }

      toast({
        title: "Upload Failed",
        description: errorMessage,
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
                    {surveys.map((survey) => (
                      <TableRow key={survey.id}>
                        <TableCell className="font-medium">
                          <div className="flex flex-col">
                            <span>{survey.display_name}</span>
                            <span className="text-xs text-muted-foreground">{survey.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {new Date(survey.version_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant={survey.status === 'active' ? 'default' : 'secondary'}>
                            {survey.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {canEdit && (
                              <Button variant="ghost" size="icon" onClick={() => navigate(`/app/projects/${project.slug}/surveys/${survey.id}`)}>
                                <Edit2 className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDownloadSurvey(survey.zip_file_path, `${survey.name}.zip`)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                  setSurveyToDelete(survey);
                                  setDeleteConfirmation("");
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
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
      </div >
    </AppLayout >
  );
};

export default ProjectDetail;
