import { useState, useEffect, useRef } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Shield,
  FolderKanban,
  Loader2
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";

const AccountPage = () => {
  const { user, profile, updateProfile } = useAuth();
  const { toast } = useToast();
  const [fullName, setFullName] = useState(profile?.full_name || "");
  // AuthContext resolves `profile` asynchronously after mount (loading is
  // set false immediately, the profile fetch runs in the background), so
  // useState's initial value above is usually captured while profile is
  // still null -- on a hard refresh this field would render empty, and
  // clicking Save would overwrite the real name with "". Re-sync once the
  // profile actually arrives, but only while the user hasn't started
  // editing -- a stale in-flight fetch resolving after they've already
  // typed a change must not clobber it.
  const fullNameEditedRef = useRef(false);
  useEffect(() => {
    if (fullNameEditedRef.current) return;
    setFullName(profile?.full_name || "");
  }, [profile?.full_name]);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Fetch user's projects
  const { data: projects } = useQuery({
    queryKey: ["userProjects", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data: memberships } = await supabase
        .from('project_members')
        .select('project_id, role, projects(id, name, slug)')
        .eq('user_id', user.id);
      return memberships || [];
    },
    enabled: !!user,
  });

  const handleSaveProfile = async () => {
    if (!user) return;

    try {
      setSaving(true);
      await updateProfile({ full_name: fullName });
      fullNameEditedRef.current = false;
      toast({
        title: "Profile updated",
        description: "Your profile has been saved successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords do not match.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters.",
        variant: "destructive",
      });
      return;
    }

    try {
      setChangingPassword(true);
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      toast({
        title: "Password changed",
        description: "Your password has been updated successfully.",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to change password.",
        variant: "destructive",
      });
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-8 max-w-3xl">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground">My Account</h1>
          <p className="text-muted-foreground">Manage your profile and account settings</p>
        </div>

        {/* Profile Settings */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Profile</CardTitle>
            </div>
            <CardDescription>Your personal information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) => {
                    fullNameEditedRef.current = true;
                    setFullName(e.target.value);
                  }}
                  placeholder="Enter your full name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={user?.email || ""}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">Email cannot be changed</p>
              </div>
            </div>
            <Button onClick={handleSaveProfile} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </CardContent>
        </Card>

        {/* My Projects */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <FolderKanban className="h-5 w-5 text-muted-foreground" />
              <CardTitle>My Projects</CardTitle>
            </div>
            <CardDescription>Projects you have access to</CardDescription>
          </CardHeader>
          <CardContent>
            {projects && projects.length > 0 ? (
              <div className="space-y-3">
                {projects.map((membership: any) => (
                  <div
                    key={membership.project_id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div>
                      <p className="font-medium">{membership.projects?.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Code: {membership.projects?.slug}
                      </p>
                    </div>
                    <Badge variant={membership.role === 'owner' ? 'default' : 'secondary'}>
                      {membership.role}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-4">
                You are not a member of any projects yet.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Security</CardTitle>
            </div>
            <CardDescription>Manage your account security</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                />
              </div>
              <Button type="submit" variant="outline" disabled={changingPassword || !newPassword}>
                {changingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Change Password
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Account Info */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Account Information</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Member Since</span>
              <span>{profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '-'}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default AccountPage;
