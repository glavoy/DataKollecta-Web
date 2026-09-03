import { useState, useEffect } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  MoreVertical,
  UserPlus,
  Loader2,
  Crown,
  Edit,
  Eye
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectMemberService, ProjectMember, UserSearchResult } from "@/services/projectMemberService";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { getErrorMessage } from "@/lib/errors/getErrorMessage";

interface ProjectMembersProps {
  projectId: string;
  projectName: string;
  userRole: string | null;
  onMemberChange?: () => void;
}

const ProjectMembers = ({ projectId, projectName, userRole, onMemberChange }: ProjectMembersProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [searchEmail, setSearchEmail] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [selectedRole, setSelectedRole] = useState<'owner' | 'editor' | 'viewer'>('viewer');
  const [searching, setSearching] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<ProjectMember | null>(null);
  const [memberToEdit, setMemberToEdit] = useState<ProjectMember | null>(null);
  const [editRole, setEditRole] = useState<'owner' | 'editor' | 'viewer'>('viewer');

  const isOwner = userRole === 'owner';

  // Fetch members
  const { data: members, isLoading } = useQuery({
    queryKey: ['projectMembers', projectId],
    queryFn: () => projectMemberService.getProjectMembers(projectId),
  });

  // Add member mutation
  const addMemberMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser || !user) return;
      await projectMemberService.addMember(projectId, selectedUser.id, selectedRole, user.id);
    },
    onSuccess: () => {
      // Invalidate both members list and any project stats that include member counts
      queryClient.invalidateQueries({ queryKey: ['projectMembers', projectId] });
      queryClient.invalidateQueries({ queryKey: ['userProjects'] }); // For Projects page
      toast({ title: "Member added", description: "User has been added to the project." });
      setIsAddDialogOpen(false);
      setSelectedUser(null);
      setSearchEmail("");
      setSearchResults([]);
      // Trigger a refetch of project data if available
      if (onMemberChange) {
        onMemberChange();
      }
    },
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to add member."),
        variant: "destructive",
      });
    },
  });

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: async () => {
      if (!memberToEdit) return;
      await projectMemberService.updateMemberRole(memberToEdit.id, editRole);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectMembers', projectId] });
      toast({ title: "Role updated", description: "Member role has been updated." });
      setMemberToEdit(null);
    },
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to update role."),
        variant: "destructive",
      });
    },
  });

  // Remove member mutation
  const removeMemberMutation = useMutation({
    mutationFn: async () => {
      if (!memberToRemove) return;
      await projectMemberService.removeMember(memberToRemove.id);
    },
    onSuccess: () => {
      // Invalidate both members list and any project stats that include member counts
      queryClient.invalidateQueries({ queryKey: ['projectMembers', projectId] });
      queryClient.invalidateQueries({ queryKey: ['userProjects'] }); // For Projects page
      toast({ title: "Member removed", description: "User has been removed from the project." });
      setMemberToRemove(null);
      // Trigger a refetch of project data if available
      if (onMemberChange) {
        onMemberChange();
      }
    },
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to remove member."),
        variant: "destructive",
      });
    },
  });

  // Debounced search effect
  useEffect(() => {
    if (searchEmail.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await projectMemberService.searchUsersByEmail(searchEmail);
        // Filter out users who are already members and the current user
        const existingIds = new Set(members?.map(m => m.user_id) || []);
        if (user?.id) {
          existingIds.add(user.id); // Exclude current user
        }
        const filtered = results.filter(u => !existingIds.has(u.id));
        setSearchResults(filtered);
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setSearching(false);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [searchEmail, members, user]);

  const handleSearch = async () => {
    if (searchEmail.length < 2) {
      toast({
        title: "Enter more characters",
        description: "Please enter at least 2 characters to search.",
        variant: "destructive",
      });
      return;
    }

    setSearching(true);
    try {
      const results = await projectMemberService.searchUsersByEmail(searchEmail);
      // Filter out users who are already members and the current user
      const existingIds = new Set(members?.map(m => m.user_id) || []);
      if (user?.id) {
        existingIds.add(user.id); // Exclude current user
      }
      const filtered = results.filter(u => !existingIds.has(u.id));
      setSearchResults(filtered);
      if (filtered.length === 0) {
        toast({
          title: "No users found",
          description: "No matching users found, or they are already members.",
        });
      }
    } catch (error) {
      toast({
        title: "Search failed",
        description: "Could not search for users.",
        variant: "destructive",
      });
    } finally {
      setSearching(false);
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner': return <Crown className="h-3 w-3" />;
      case 'editor': return <Edit className="h-3 w-3" />;
      case 'viewer': return <Eye className="h-3 w-3" />;
      default: return null;
    }
  };

  const getRoleBadgeVariant = (
    role: string,
  ): "default" | "secondary" | "outline" => {
    switch (role) {
      case 'owner': return 'default';
      case 'editor': return 'secondary';
      case 'viewer': return 'outline';
      default: return 'outline';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Project Members</h2>
          <p className="text-sm text-muted-foreground">
            Manage who has access to this project on the web
          </p>
        </div>
        {isOwner && (
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Member
          </Button>
        )}
      </div>

      {/* Role Descriptions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Role Permissions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="w-20 justify-center gap-1">
              <Crown className="h-3 w-3" /> Owner
            </Badge>
            <span className="text-muted-foreground">Full access - can manage members, surveys, and delete the project</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="w-20 justify-center gap-1">
              <Edit className="h-3 w-3" /> Editor
            </Badge>
            <span className="text-muted-foreground">Can create/edit surveys, manage field team, and view/export data</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="w-20 justify-center gap-1">
              <Eye className="h-3 w-3" /> Viewer
            </Badge>
            <span className="text-muted-foreground">Read-only access to view and export data</span>
          </div>
        </CardContent>
      </Card>

      {/* Members Table */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {isLoading ? "Loading..." : `${members?.length || 0} member${members?.length !== 1 ? 's' : ''}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Added</TableHead>
                {isOwner && <TableHead className="w-[50px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members?.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{member.profiles?.full_name || 'Unknown'}</p>
                      <p className="text-sm text-muted-foreground">{member.profiles?.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getRoleBadgeVariant(member.role)} className="gap-1">
                      {getRoleIcon(member.role)}
                      {member.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(member.invited_at), 'MMM d, yyyy')}
                  </TableCell>
                  {isOwner && (
                    <TableCell>
                      {member.user_id !== user?.id && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => {
                              setMemberToEdit(member);
                              setEditRole(member.role as 'owner' | 'editor' | 'viewer');
                            }}>
                              Change Role
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setMemberToRemove(member)}
                            >
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {!isLoading && (!members || members.length === 0) && (
                <TableRow>
                  <TableCell colSpan={isOwner ? 4 : 3} className="text-center h-24 text-muted-foreground">
                    No members found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Member Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Project Member</DialogTitle>
            <DialogDescription>
              Search for an existing user by email to add them to {projectName}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Input
                    placeholder="Search by email or name..."
                    value={searchEmail}
                    onChange={(e) => setSearchEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                  {searching && (
                    <Loader2 className="h-4 w-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Start typing to search. Matches email or name (e.g., "geoff" finds "geofflavoy@yahoo.ca")
              </p>
            </div>

            {searchResults.length > 0 && (
              <div className="border rounded-md max-h-48 overflow-y-auto">
                {searchResults.map((result) => (
                  <div
                    key={result.id}
                    className={`p-3 cursor-pointer hover:bg-accent ${
                      selectedUser?.id === result.id ? 'bg-accent' : ''
                    }`}
                    onClick={() => setSelectedUser(result)}
                  >
                    <p className="font-medium">{result.full_name || 'No name'}</p>
                    <p className="text-sm text-muted-foreground">{result.email}</p>
                  </div>
                ))}
              </div>
            )}

            {selectedUser && (
              <div className="space-y-2">
                <Label>Selected User</Label>
                <div className="p-3 border rounded-md bg-muted">
                  <p className="font-medium">{selectedUser.full_name || selectedUser.email}</p>
                  <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
                </div>

                <Label>Role</Label>
                <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as 'owner' | 'editor' | 'viewer')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner - Full control including project settings and deletion</SelectItem>
                    <SelectItem value="editor">Editor - Can edit surveys and manage field team</SelectItem>
                    <SelectItem value="viewer">Viewer - Read-only access to data</SelectItem>
                  </SelectContent>
                </Select>
                {selectedRole === 'owner' && (
                  <p className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded p-2">
                    ⚠️ Owners have full control including the ability to delete the project and manage all members.
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => addMemberMutation.mutate()}
              disabled={!selectedUser || addMemberMutation.isPending}
            >
              {addMemberMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={!!memberToEdit} onOpenChange={(open) => !open && setMemberToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Member Role</DialogTitle>
            <DialogDescription>
              Update the role for {memberToEdit?.profiles?.full_name || memberToEdit?.profiles?.email}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-3">
            <div>
              <Label>New Role</Label>
              <Select value={editRole} onValueChange={(v) => setEditRole(v as 'owner' | 'editor' | 'viewer')}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner - Full control</SelectItem>
                  <SelectItem value="editor">Editor - Can edit surveys and manage field team</SelectItem>
                  <SelectItem value="viewer">Viewer - Read-only access</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editRole === 'owner' && (
              <p className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded p-2">
                ⚠️ This will give the member full control including the ability to delete the project.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMemberToEdit(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateRoleMutation.mutate()}
              disabled={updateRoleMutation.isPending}
            >
              {updateRoleMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation */}
      <AlertDialog open={!!memberToRemove} onOpenChange={(open) => !open && setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {memberToRemove?.profiles?.full_name || memberToRemove?.profiles?.email} from this project?
              They will lose access to all project data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeMemberMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ProjectMembers;
