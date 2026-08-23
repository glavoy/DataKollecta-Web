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
  AlertTriangle,
  ShieldCheck,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { fetchAllRows } from "@/lib/supabasePaging";
import { projectService } from "@/services/projectService";
import { ProjectStatus, STATUS_LABEL, STATUS_DESCRIPTION, STATUS_BADGE_CLASS } from "@/lib/projectStatus";

interface ProjectSettingsProps {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string;
    status: ProjectStatus;
    archived_at: string | null;
  };
  userRole: string | null;
  onProjectUpdate: () => void;
  /** Whether this project has a currently-deployed survey -- gates the
   *  pause confirmation, since pausing is the one action here that can
   *  interrupt live field collection. */
  hasDeployedSurveys: boolean;
}

const ProjectSettings = ({ project, userRole, onProjectUpdate, hasDeployedSurveys }: ProjectSettingsProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [saving, setSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Status and archiving are immediate-apply (via projectService), unlike
  // name/description which stay staged behind the "Save Changes" button
  // below -- pausing now has real enforcement teeth (see applyStatusChange)
  // and bundling it into a generic multi-field save would make it too easy
  // to pause a project as a side effect of an unrelated text edit.
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [statusSaving, setStatusSaving] = useState(false);
  const [pauseWarningOpen, setPauseWarningOpen] = useState(false);
  const [archiveWarningOpen, setArchiveWarningOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const isOwner = userRole === 'owner';

  const applyStatusChange = async (next: ProjectStatus) => {
    setStatusSaving(true);
    try {
      await projectService.setProjectStatus(project.id, next);
      setStatus(next);
      toast({
        title: "Status updated",
        description: next === 'paused'
          ? "Field access is now revoked -- new logins are blocked and any device already logged in loses access on its next sync."
          : "Field access restored -- devices can log in and sync again.",
      });
      onProjectUpdate();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update status.",
        variant: "destructive",
      });
    } finally {
      setStatusSaving(false);
    }
  };

  const handleStatusToggle = (checked: boolean) => {
    const next: ProjectStatus = checked ? 'active' : 'paused';
    // Already-archived projects have no field access to lose -- pausing
    // one is a no-op on the ground, so skip the confirmation.
    if (next === 'paused' && hasDeployedSurveys && !project.archived_at) {
      setPauseWarningOpen(true);
      return;
    }
    applyStatusChange(next);
  };

  const applyArchiveChange = async (archived: boolean) => {
    setArchiving(true);
    try {
      await projectService.setProjectArchived(project.id, archived);
      toast({
        title: archived ? "Project archived" : "Project unarchived",
        description: archived
          ? (status === 'active'
              ? "Hidden from your default project list, and field access is now revoked."
              : "Hidden from your default project list.")
          : (status === 'active'
              ? "Back in your default project list, and field access is restored."
              : "Back in your default project list."),
      });
      onProjectUpdate();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update.",
        variant: "destructive",
      });
    } finally {
      setArchiving(false);
    }
  };

  const handleArchiveClick = () => {
    const willArchive = !project.archived_at;
    // Only archiving (not unarchiving) can remove access, and only when the
    // project is currently Active with something field workers could
    // actually be collecting against.
    if (willArchive && status === 'active' && hasDeployedSurveys) {
      setArchiveWarningOpen(true);
      return;
    }
    applyArchiveChange(willArchive);
  };

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
      // Delete in order: formchanges → submissions → survey_packages (storage
      // only, see step 4) → app_sessions → app_credentials → project_members
      // → projects.
      //
      // crfs and survey_packages rows are deliberately NOT deleted here --
      // they cascade from the `projects` delete at the end. That is a
      // change from deleting them explicitly: the survey lifecycle guard
      // triggers (enforce_survey_package_delete_guard /
      // enforce_crf_parent_unlocked) refuse a DIRECT delete of a
      // deployed/complete survey or its forms, precisely so a locked
      // survey can't be removed out from under field devices by any route
      // other than deleting the whole project. They exempt cascades that
      // arrive because the parent row is already gone (Postgres removes
      // the parent before running the RI cascade) -- which is exactly the
      // path `DELETE FROM projects` takes, but an explicit
      // `DELETE FROM survey_packages ... WHERE project_id = ...` is not:
      // the parent project row is still very much present, so the guard
      // would fire and abort this entire "delete project" flow the moment
      // it hit a project that had ever deployed a survey.

      // 1. Delete formchanges directly by project_id -- it carries that
      // column itself (NOT NULL), so there is no need to enumerate
      // submissions' local_unique_ids first. That indirect approach used to
      // be the only option and had two problems: an unpaged select()
      // silently returned only the first 1000 submissions, orphaning
      // formchanges past that point; and even fully paged, it can never
      // find a formchanges row whose submission was already deleted by an
      // earlier partial/failed run -- exactly the state a wedged project
      // from before this fix would be in. Filtering by project_id catches
      // those too. See migration 20260822055223 for the matching DB-level
      // fix (formchanges.project_id now cascades from projects), which
      // makes this belt-and-suspenders once deployed rather than load-
      // bearing on its own.
      await supabase.from('formchanges').delete().eq('project_id', project.id);

      // 2. Delete submissions
      await supabase.from('submissions').delete().eq('project_id', project.id);

      // 3. Storage isn't governed by the DB's referential integrity, so it
      // needs its own cleanup regardless of how the rows go away -- collect
      // every zip path now and remove the objects. The survey_packages and
      // crfs ROWS are left for the `projects` cascade (see the note above).
      const surveyPackages = await fetchAllRows<{ zip_file_path: string | null }>((from, to) =>
        supabase.from('survey_packages').select('zip_file_path').eq('project_id', project.id).range(from, to),
      );

      const filePaths = surveyPackages.map(s => s.zip_file_path).filter((p): p is string => Boolean(p));
      if (filePaths.length > 0) {
        await supabase.storage.from('surveys').remove(filePaths);
      }

      // 4. Delete app sessions
      await supabase.from('app_sessions').delete().eq('project_id', project.id);

      // 5. Delete app credentials
      await supabase.from('app_credentials').delete().eq('project_id', project.id);

      // 6. Delete project members
      await supabase.from('project_members').delete().eq('project_id', project.id);

      // 7. Delete the project -- cascades to survey_packages, then from
      // there to crfs (both ON DELETE CASCADE), which is what lets this
      // succeed even when the project contains a locked survey.
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

          {isOwner && (
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Access & Visibility -- immediate-apply, deliberately separate from
          the General card's staged Save Changes: pausing has real
          enforcement effects and shouldn't ride along with an unrelated
          text edit. */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Access & Visibility</CardTitle>
          </div>
          <CardDescription>Field-device access and where this project shows up in your list</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Project Status</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge className={STATUS_BADGE_CLASS[status]}>{STATUS_LABEL[status]}</Badge>
                  {statusSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>
              </div>
              <Switch
                checked={status === 'active'}
                onCheckedChange={handleStatusToggle}
                disabled={!isOwner || statusSaving}
              />
            </div>
            <div className="p-3 bg-muted rounded-md text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">What does this mean?</p>
              <p>{STATUS_DESCRIPTION[status]}</p>
              {project.archived_at && status === 'active' && (
                <p className="mt-1 text-foreground">
                  This project is currently archived, so field access is blocked regardless --
                  unarchive below to actually restore it.
                </p>
              )}
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{project.archived_at ? 'Archived' : 'Archive project'}</p>
              <p className="text-sm text-muted-foreground">
                {project.archived_at
                  ? 'Hidden from your default project list, and field access stays revoked until you unarchive.'
                  : 'Hides this project from your default list and revokes field access (same as pausing) -- unarchive anytime to restore exactly as it was.'}
              </p>
            </div>
            {isOwner && (
              <Button variant="outline" onClick={handleArchiveClick} disabled={archiving}>
                {archiving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : project.archived_at ? (
                  <ArchiveRestore className="h-4 w-4 mr-2" />
                ) : (
                  <Archive className="h-4 w-4 mr-2" />
                )}
                {project.archived_at ? 'Unarchive' : 'Archive'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Pause-with-deployed-surveys confirmation, and the equivalent for
          Archive right below it -- both can interrupt live field
          collection now that archiving revokes access the same way pausing
          does, so both get the same style of confirmation. */}
      <AlertDialog open={pauseWarningOpen} onOpenChange={setPauseWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This project has a deployed survey. Pausing blocks new logins immediately, and any
              device already logged in loses access the next time it tries to sync -- including
              mid-collection. Portal editing is unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setPauseWarningOpen(false); applyStatusChange('paused'); }}
            >
              Pause anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={archiveWarningOpen} onOpenChange={setArchiveWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This project has a deployed survey. Archiving blocks new logins immediately, and any
              device already logged in loses access the next time it tries to sync -- including
              mid-collection. It also disappears from your default project list. Portal editing is
              unaffected, and unarchiving restores everything at once.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setArchiveWarningOpen(false); applyArchiveChange(true); }}
            >
              Archive anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
