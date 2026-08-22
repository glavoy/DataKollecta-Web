import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
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
  Settings,
  Trash2,
  Loader2,
  AlertTriangle
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { fetchAllRows, chunkIds } from "@/lib/supabasePaging";

interface ProjectSettingsProps {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string;
    is_active: boolean;
  };
  userRole: string | null;
  onProjectUpdate: () => void;
}

const ProjectSettings = ({ project, userRole, onProjectUpdate }: ProjectSettingsProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [isActive, setIsActive] = useState(project.is_active);
  const [saving, setSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const isOwner = userRole === 'owner';

  const handleSave = async () => {
    if (!name.trim()) {
      toast({
        title: "Error",
        description: "Project name is required.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('projects')
        .update({
          name: name.trim(),
          description: description.trim(),
          is_active: isActive,
          updated_at: new Date().toISOString(),
        })
        .eq('id', project.id);

      if (error) throw error;

      toast({
        title: "Settings saved",
        description: "Project settings have been updated.",
      });
      onProjectUpdate();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save settings.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmText !== project.slug) {
      toast({
        title: "Error",
        description: "Please type the project code correctly to confirm.",
        variant: "destructive",
      });
      return;
    }

    setDeleting(true);
    try {
      // Delete in order: formchanges → submissions → crfs → survey_packages →
      // app_sessions → app_credentials → project_members → projects

      // 1. Get all submissions to find their local_unique_ids for
      // formchanges. Paged -- an unpaged select() here silently returns
      // only the first 1000 rows, leaving formchanges past that point
      // orphaned; with no ON DELETE CASCADE from projects, those orphans
      // later make step 8 fail with everything else already deleted,
      // wedging the project in an undeletable half-deleted state.
      const submissions = await fetchAllRows<{ local_unique_id: string | null }>((from, to) =>
        supabase.from('submissions').select('local_unique_id').eq('project_id', project.id).range(from, to),
      );

      if (submissions.length > 0) {
        const recordUuids = submissions.map(s => s.local_unique_id).filter((id): id is string => id !== null);
        // Chunked -- 1000+ UUIDs in one .in() exceeds a GET querystring's
        // practical length ceiling and fails as a 414.
        for (const chunk of chunkIds(recordUuids)) {
          await supabase.from('formchanges').delete().in('record_uuid', chunk);
        }
      }

      // 2. Delete submissions
      await supabase.from('submissions').delete().eq('project_id', project.id);

      // 3. Delete CRFs
      await supabase.from('crfs').delete().eq('project_id', project.id);

      // 4. Delete survey packages (and their storage files)
      const surveyPackages = await fetchAllRows<{ zip_file_path: string | null }>((from, to) =>
        supabase.from('survey_packages').select('zip_file_path').eq('project_id', project.id).range(from, to),
      );

      const filePaths = surveyPackages.map(s => s.zip_file_path).filter((p): p is string => Boolean(p));
      if (filePaths.length > 0) {
        await supabase.storage.from('surveys').remove(filePaths);
      }
      await supabase.from('survey_packages').delete().eq('project_id', project.id);

      // 5. Delete app sessions
      await supabase.from('app_sessions').delete().eq('project_id', project.id);

      // 6. Delete app credentials
      await supabase.from('app_credentials').delete().eq('project_id', project.id);

      // 7. Delete project members
      await supabase.from('project_members').delete().eq('project_id', project.id);

      // 8. Delete the project
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', project.id);

      if (error) throw error;

      toast({
        title: "Project deleted",
        description: "The project and all its data have been permanently deleted.",
      });

      navigate('/app/projects');
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete project.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">Project Settings</h2>
        <p className="text-sm text-muted-foreground">
          Manage project configuration and preferences
        </p>
      </div>

      {/* General Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-muted-foreground" />
            <CardTitle>General</CardTitle>
          </div>
          <CardDescription>Basic project information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Project Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Project Code</Label>
            <Input
              id="slug"
              value={project.slug}
              disabled
              className="bg-muted"
            />
            <p className="text-xs text-muted-foreground">
              Project code cannot be changed. Field workers use this to log in.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional project description"
              disabled={!isOwner}
              rows={3}
            />
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Project Status</p>
                <p className="text-sm text-muted-foreground">
                  {isActive ? "Active" : "Inactive"}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={!isOwner}
              />
            </div>
            <div className="p-3 bg-muted rounded-md text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">What does this mean?</p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Active:</strong> Field workers can download surveys and upload data from the mobile app</li>
                <li><strong>Inactive:</strong> Project is hidden from the mobile app. Field workers cannot access it. Useful when data collection is complete or paused.</li>
              </ul>
            </div>
          </div>

          {isOwner && (
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      {isOwner && (
        <Card className="border-destructive">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
            </div>
            <CardDescription>
              Irreversible actions that affect this project
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Delete Project</p>
                <p className="text-sm text-muted-foreground">
                  Permanently delete this project and all its data
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Project
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                This will permanently delete <strong>{project.name}</strong> and all associated data including:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li>All surveys and forms</li>
                <li>All collected data (submissions)</li>
                <li>All field team credentials</li>
                <li>All project members</li>
              </ul>
              <p className="font-medium pt-2">
                Type <code className="bg-muted px-1 rounded">{project.slug}</code> to confirm:
              </p>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Enter project code"
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmText("")}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteConfirmText !== project.slug || deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ProjectSettings;
