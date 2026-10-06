import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { fetchAllRows } from "@/lib/supabasePaging";
import { projectService } from "@/services/projectService";
import {
  ProjectStatus,
  STATUS_LABEL,
  STATUS_DESCRIPTION,
  STATUS_BADGE_CLASS,
  ARCHIVED_BADGE_CLASS,
} from "@/lib/projectStatus";
import { getErrorMessage } from "@/lib/errors/getErrorMessage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HelpLink } from "@/components/docs/HelpLink";

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
  const queryClient = useQueryClient();
  const [lockReason, setLockReason] = useState('');
  const [lockSaving, setLockSaving] = useState(false);
  const lockQuery = useQuery({
    queryKey: ['project-data-lock', project.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('project_data_locks')
        .select('locked, reason, changed_at').eq('project_id', project.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const changeDataLock = async () => {
    if (!lockReason.trim() || lockQuery.isError || lockQuery.isPending) return;
    setLockSaving(true);
    try {
      const { error } = await supabase.rpc('set_project_data_lock', {
        p_project_id: project.id, p_locked: !lockQuery.data?.locked, p_reason: lockReason.trim(),
      });
      if (error) throw error;
      setLockReason('');
      await queryClient.invalidateQueries({ queryKey: ['project-data-lock', project.id] });
      toast({ title: 'Data lock updated', description: 'The change and reason have been recorded.' });
    } catch (error) {
      toast({ title: 'Data lock failed', description: getErrorMessage(error, 'The data lock could not be changed.'), variant: 'destructive' });
    } finally { setLockSaving(false); }
  };

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
  //
  // `status` and `archivedAt` are local optimistic mirrors of the two DB
  // columns, updated immediately on success rather than waiting for
  // `onProjectUpdate`'s refetch to come back through props. Together they
  // form one displayed 3-state ladder -- Active / Paused / Archived -- see
  // `displayState` below and the doc comment on projectStatus.ts.
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [archivedAt, setArchivedAt] = useState<string | null>(project.archived_at);
  const [statusSaving, setStatusSaving] = useState(false);
  const [pauseWarningOpen, setPauseWarningOpen] = useState(false);
  const [archiveWarningOpen, setArchiveWarningOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const isOwner = userRole === 'owner';
  const displayState: ProjectStatus | 'archived' = archivedAt ? 'archived' : status;

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
    } catch (error) {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to update status."),
        variant: "destructive",
      });
    } finally {
      setStatusSaving(false);
    }
  };

  const applyArchiveChange = async (archived: boolean) => {
    setArchiving(true);
    try {
      await projectService.setProjectArchived(project.id, archived);
      // Unarchiving always reactivates (see projectService.setProjectArchived),
      // so the local mirror follows suit rather than waiting on a refetch.
      setArchivedAt(archived ? new Date().toISOString() : null);
      if (!archived) setStatus('active');
      toast({
        title: archived ? "Project archived" : "Project unarchived",
        description: archived
          ? (status === 'active'
              ? "Hidden from your project list, and field access is now revoked."
              : "Hidden from your project list.")
          : "Back in your project list, and set to Active -- field access is restored.",
      });
      onProjectUpdate();
    } catch (error) {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to update."),
        variant: "destructive",
      });
    } finally {
      setArchiving(false);
    }
  };

  // The single entry point for the 3-way Active/Paused/Archived control.
  // Archived is reachable from either Active or Paused; the only way out of
  // Archived is back to Active (Paused is disabled as a trigger while
  // archived, but this guard covers it regardless of how it's invoked).
  const handleSelectState = (next: ProjectStatus | 'archived') => {
    if (next === displayState) return;

    if (next === 'archived') {
      // Only archiving FROM Active can remove access field workers are
      // relying on right now; archiving from Paused has nothing left to lose.
      if (status === 'active' && hasDeployedSurveys) {
        setArchiveWarningOpen(true);
        return;
      }
      applyArchiveChange(true);
      return;
    }

    if (displayState === 'archived') {
      if (next === 'active') applyArchiveChange(false);
      return;
    }

    if (next === 'paused' && hasDeployedSurveys) {
      setPauseWarningOpen(true);
      return;
    }
    applyStatusChange(next);
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
    } catch (error) {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to save settings."),
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
      // Delete only an empty project. The database repeats this check
      // atomically and refuses cascades that would destroy retained records.
      const [submissionCheck, auditCheck] = await Promise.all([
        supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('project_id', project.id),
        supabase.from('formchanges').select('id', { count: 'exact', head: true }).eq('project_id', project.id),
      ]);
      if (submissionCheck.error) throw submissionCheck.error;
      if (auditCheck.error) throw auditCheck.error;
      if (submissionCheck.count || auditCheck.count) {
        throw new Error('This project contains retained data. Archive it instead of deleting.');
      }
      const surveyPackages = await fetchAllRows<{ zip_file_path: string | null }>((from, to) =>
        supabase.from('survey_packages').select('zip_file_path').eq('project_id', project.id).order('id').range(from, to),
      );
      const { error, count } = await supabase.from('projects').delete({ count: 'exact' }).eq('id', project.id);
      if (error) throw error;
      if (!count) throw new Error('Project deletion was not authorised.');
      // Storage cleanup follows successful database deletion, never precedes it.
      const paths = surveyPackages.map(p => p.zip_file_path).filter((p): p is string => Boolean(p));
      if (paths.length) {
        const { error: storageError } = await supabase.storage.from('surveys').remove(paths);
        if (storageError) toast({ title: 'Storage cleanup required', description: 'The empty project was deleted, but its unused package files could not be removed.', variant: 'destructive' });
      }

      toast({
        title: "Project deleted",
        description: "The empty project has been deleted.",
      });

      navigate('/app/projects');
    } catch (error) {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to delete project."),
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
        <h2 className="text-xl font-semibold flex items-center gap-2">Project Settings <HelpLink slug="projects/settings" /></h2>
        <p className="text-sm text-muted-foreground">
          Manage project configuration and preferences
        </p>
      </div>

      {/* General Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Data lock</CardTitle>
          <CardDescription>Locking prevents new records and changes, including delayed uploads. Read access and export remain available. Obtain renewed data endorsement after authorised reopening and correction.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p role="status">{lockQuery.isPending ? 'Checking data lock…' : lockQuery.isError ? 'Data lock status could not be verified.' : lockQuery.data?.locked ? 'Data are locked' : 'Data are open for collection'}</p>
          {isOwner && <>
            <Label htmlFor="data-lock-reason">Reason for locking or reopening</Label>
            <Textarea id="data-lock-reason" value={lockReason} onChange={event => setLockReason(event.target.value)} disabled={lockSaving} />
            <Button onClick={changeDataLock} disabled={lockSaving || lockQuery.isPending || lockQuery.isError || !lockReason.trim()}>
              {lockSaving ? 'Saving…' : lockQuery.data?.locked ? 'Reopen data' : 'Lock data'}
            </Button>
          </>}
        </CardContent>
      </Card>
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
          the General card's staged Save Changes: changing this has real
          enforcement effects and shouldn't ride along with an unrelated
          text edit. One 3-way control rather than a switch plus a separate
          archive button: Active / Paused / Archived is a single ladder
          (Active <-> Paused, either -> Archived, Archived -> Active only),
          so showing it as two independent toggles implied combinations that
          don't actually exist. */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Access & Visibility</CardTitle>
          </div>
          <CardDescription>Field-device access and where this project shows up in your list</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge className={displayState === 'archived' ? ARCHIVED_BADGE_CLASS : STATUS_BADGE_CLASS[displayState]}>
                {displayState === 'archived' ? 'Archived' : STATUS_LABEL[displayState]}
              </Badge>
              {(statusSaving || archiving) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            <Tabs value={displayState} onValueChange={(v) => handleSelectState(v as ProjectStatus | 'archived')}>
              <TabsList>
                <TabsTrigger value="active" disabled={!isOwner || statusSaving || archiving}>
                  Active
                </TabsTrigger>
                <TabsTrigger
                  value="paused"
                  disabled={!isOwner || statusSaving || archiving || displayState === 'archived'}
                >
                  Paused
                </TabsTrigger>
                <TabsTrigger value="archived" disabled={!isOwner || statusSaving || archiving}>
                  Archived
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="p-3 bg-muted rounded-md text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">What does this mean?</p>
            {displayState === 'archived' ? (
              <p>
                Hidden from your project list, and field access is fully revoked. Select Active
                above to unarchive and restore access immediately.
              </p>
            ) : (
              <p>{STATUS_DESCRIPTION[displayState]}</p>
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
                Only an empty project can be permanently deleted. Projects containing collected records or audit history must be archived. Deleting <strong>{project.name}</strong> removes its unused configuration including:
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
