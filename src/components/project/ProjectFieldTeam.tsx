import { useState, useEffect, useCallback} from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Plus,
  MoreVertical,
  Search,
  Key,
  Clock,
  Smartphone,
  Loader2,
  Eye,
  EyeOff
} from "lucide-react";
import { teamService, type FieldWorker } from "@/services/teamService";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { getErrorMessage } from "@/lib/errors/getErrorMessage";
import { isUniqueViolation } from "@/lib/errors/postgrestError";
import { PASSWORD_MIN_LENGTH } from "@/lib/passwordPolicy";

interface ProjectFieldTeamProps {
  projectId: string;
  projectName: string;
  userRole: string | null;
}

const ProjectFieldTeam = ({ projectId, projectName, userRole }: ProjectFieldTeamProps) => {
  const { toast } = useToast();
  const [workers, setWorkers] = useState<FieldWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Add dialog state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [adding, setAdding] = useState(false);

  // Delete confirmation
  const [workerToDelete, setWorkerToDelete] = useState<FieldWorker | null>(null);

  // Edit dialog state
  const [workerToEdit, setWorkerToEdit] = useState<FieldWorker | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset-password dialog state
  const [workerToReset, setWorkerToReset] = useState<FieldWorker | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetting, setResetting] = useState(false);

  const canManage = userRole === 'owner' || userRole === 'editor';


  // useCallback, above the effect that depends on it -- see the note in
  // Projects.tsx. `toast` is module-level and stable.
  const loadWorkers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await teamService.getFieldWorkers(projectId);
      setWorkers(data);
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to load field team credentials.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => {
    loadWorkers();
  }, [loadWorkers]);

  const filteredWorkers = workers.filter(w =>
    w.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (w.description && w.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleAddCredential = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newUsername || !newPassword) {
      toast({
        title: "Error",
        description: "Username and password are required.",
        variant: "destructive",
      });
      return;
    }

    setAdding(true);
    try {
      await teamService.createCredential(projectId, newUsername, newPassword, newDescription);
      toast({
        title: "Credential created",
        description: `Field worker "${newUsername}" has been added.`,
      });
      setIsAddDialogOpen(false);
      setNewUsername("");
      setNewPassword("");
      setNewDescription("");
      loadWorkers();
    } catch (error) {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to create credential."),
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteCredential = async () => {
    if (!workerToDelete) return;

    try {
      await teamService.deleteCredential(workerToDelete.id);
      toast({
        title: "Credential revoked",
        description: `Access for "${workerToDelete.username}" has been revoked.`,
      });
      setWorkerToDelete(null);
      loadWorkers();
    } catch (error) {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to revoke credential."),
        variant: "destructive",
      });
    }
  };

  const handleToggleStatus = async (worker: FieldWorker) => {
    try {
      await teamService.toggleStatus(worker.id, !worker.is_active);
      toast({
        title: worker.is_active ? "Credential disabled" : "Credential enabled",
        description: `"${worker.username}" has been ${worker.is_active ? 'disabled' : 'enabled'}.`,
      });
      loadWorkers();
    } catch (error) {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to update credential status."),
        variant: "destructive",
      });
    }
  };

  const handleOpenEdit = (worker: FieldWorker) => {
    setWorkerToEdit(worker);
    setEditUsername(worker.username);
    setEditDescription(worker.description || "");
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerToEdit) return;

    if (!editUsername.trim()) {
      toast({
        title: "Error",
        description: "Username is required.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await teamService.updateCredential(workerToEdit.id, {
        username: editUsername.trim(),
        description: editDescription.trim() || null,
      });
      toast({
        title: "Credential updated",
        description: `Changes to "${editUsername}" have been saved.`,
      });
      setWorkerToEdit(null);
      loadWorkers();
    } catch (error) {
      // (project_id, username) is unique -- surface a real collision as a
      // real message instead of the raw Postgres constraint text.
      const isDuplicate = isUniqueViolation(error);
      toast({
        title: "Error",
        description: isDuplicate
          ? `"${editUsername}" is already in use on this project.`
          : getErrorMessage(error, "Failed to update credential."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleOpenReset = (worker: FieldWorker) => {
    setWorkerToReset(worker);
    setResetPassword("");
    setResetConfirm("");
    setShowResetPassword(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerToReset) return;

    if (resetPassword !== resetConfirm) {
      toast({
        title: "Error",
        description: "The two passwords do not match.",
        variant: "destructive",
      });
      return;
    }

    setResetting(true);
    try {
      // Length and "not the username" are enforced by the RPC; its messages
      // come back through getErrorMessage unchanged.
      const result = await teamService.resetCredentialPassword(workerToReset.id, resetPassword);
      const signedOut = result?.sessions_revoked ?? 0;
      toast({
        title: "Password reset",
        description:
          `"${workerToReset.username}" has a new password.` +
          (signedOut > 0
            ? ` ${signedOut} device session${signedOut === 1 ? " was" : "s were"} signed out; ` +
              "field workers must enter the new password in the app's Settings."
            : ""),
      });
      setWorkerToReset(null);
      loadWorkers();
    } catch (error) {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to reset password."),
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  };

  const activeCount = workers.filter(w => w.is_active).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Field Team</h2>
          <p className="text-sm text-muted-foreground">
            Manage app credentials for mobile data collectors
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Credential
          </Button>
        )}
      </div>

      {/* Info Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Smartphone className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">How Field Team Credentials Work</p>
              <p className="text-muted-foreground mt-1">
                Field workers use these credentials to log into the mobile app. They enter the
                <strong> project code </strong>(<code className="bg-muted px-1 rounded">{projectName}</code>),
                along with their username and password to access surveys and upload data.
              </p>
              <p className="text-muted-foreground mt-1">
                Every credential gives access to all of this project's surveys. Separate
                credentials let you tell who uploaded each record (it is attributed to the
                username) and revoke one worker or team without affecting the rest. Resetting a
                password signs out every device using it until the new password is entered in
                the app's Settings.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Credentials</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{workers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{activeCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by username or description..."
          className="pl-10"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Credentials Table */}
      <Card>
        <CardHeader>
          <CardTitle>App Credentials</CardTitle>
          <CardDescription>
            {loading ? "Loading..." : `${filteredWorkers.length} credential${filteredWorkers.length !== 1 ? 's' : ''}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="w-[50px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredWorkers.map((worker) => (
                <TableRow key={worker.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium font-mono">{worker.username}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {worker.description || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-muted-foreground text-sm">
                      <Clock className="h-3 w-3" />
                      {worker.last_used_at
                        ? formatDistanceToNow(new Date(worker.last_used_at), { addSuffix: true })
                        : "Never"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={worker.is_active ? 'default' : 'secondary'}>
                      {worker.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenEdit(worker)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleOpenReset(worker)}>
                            Reset password
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggleStatus(worker)}>
                            {worker.is_active ? 'Disable' : 'Enable'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setWorkerToDelete(worker)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {!loading && filteredWorkers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 5 : 4} className="text-center h-24 text-muted-foreground">
                    {workers.length === 0
                      ? "No credentials yet. Add one to get started."
                      : "No credentials match your search."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Credential Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Field Team Credential</DialogTitle>
            <DialogDescription>
              Create login credentials for a mobile data collector.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddCredential}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="e.g., surveyor1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Input
                  id="description"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="e.g., John's phone, Tablet #3"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={adding}>
                {adding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Credential
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Credential Dialog -- username/description only. The password
          has its own dialog below, backed by a server-side RPC, since it is
          bcrypt-hashed and the plaintext never reaches the client. */}
      <Dialog open={!!workerToEdit} onOpenChange={(open) => !open && setWorkerToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Field Team Credential</DialogTitle>
            <DialogDescription>
              Update the username or description for this credential.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveEdit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-username">Username</Label>
                <Input
                  id="edit-username"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  placeholder="e.g., surveyor1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-description">Description (optional)</Label>
                <Input
                  id="edit-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="e.g., John's phone, Tablet #3"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setWorkerToEdit(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!workerToReset} onOpenChange={(open) => !open && setWorkerToReset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for "{workerToReset?.username}". Every device signed in with
              this credential is signed out immediately; field workers then enter the new
              password by tapping the project in the app's Settings. Unsynced records stay on
              the phone until they do.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResetPassword}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="reset-password">New password</Label>
                <div className="relative">
                  <Input
                    id="reset-password"
                    type={showResetPassword ? "text" : "password"}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                    autoComplete="new-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowResetPassword(!showResetPassword)}
                  >
                    {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reset-confirm">Confirm new password</Label>
                <Input
                  id="reset-confirm"
                  type={showResetPassword ? "text" : "password"}
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setWorkerToReset(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={resetting || !resetPassword}>
                {resetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reset Password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!workerToDelete} onOpenChange={(open) => !open && setWorkerToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Credential?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the credential for "{workerToDelete?.username}"?
              This will immediately revoke their access to the mobile app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCredential}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ProjectFieldTeam;
