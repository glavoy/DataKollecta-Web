import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Search,
  MoreVertical,
  Users,
  FileSpreadsheet,
  Database,
  Loader2
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import CreateProjectDialog from "@/components/projects/CreateProjectDialog";

interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  surveysCount?: number;
  submissionsCount?: number;
  membersCount?: number;
  role: string;
}

const Projects = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchProjects();
  }, [user]);

  const fetchProjects = async () => {
    if (!user) return;

    try {
      setLoading(true);

      // Fetch project IDs where user is a member, and this user's role on each
      const { data: memberships, error: memberError } = await supabase
        .from('project_members')
        .select('project_id, role')
        .eq('user_id', user.id);

      if (memberError) {
        console.error('Error fetching memberships:', memberError);
        throw memberError;
      }

      // If no memberships, user has no projects - this is not an error
      if (!memberships || memberships.length === 0) {
        setProjects([]);
        return;
      }

      const roleByProjectId = new Map(memberships.map(m => [m.project_id, m.role]));

      // Fetch the actual projects
      const projectIds = memberships.map(m => m.project_id);
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .in('id', projectIds)
        .order('created_at', { ascending: false });

      if (projectsError) {
        console.error('Error fetching projects:', projectsError);
        throw projectsError;
      }

      // Fetch stats for each project
      const projectsWithStats = await Promise.all(
        (projectsData || []).map(async (project) => {
          // Get surveys count
          const { count: surveysCount } = await supabase
            .from('survey_packages')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', project.id);

          // Get submissions count
          const { count: submissionsCount } = await supabase
            .from('submissions')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', project.id);

          // Get members count
          const { count: membersCount } = await supabase
            .from('project_members')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', project.id);

          return {
            ...project,
            surveysCount: surveysCount || 0,
            submissionsCount: submissionsCount || 0,
            membersCount: membersCount || 0,
            role: roleByProjectId.get(project.id) ?? 'member',
          };
        })
      );

      setProjects(projectsWithStats);
    } catch (error: any) {
      console.error('Error in fetchProjects:', error);
      toast({
        title: "Error",
        description: "Failed to load projects. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async (projectData: {
    name: string;
    slug: string;
    description: string;
  }) => {
    if (!user) return;

    try {
      setCreating(true);

      // Create the project (always active on creation)
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          name: projectData.name,
          slug: projectData.slug,
          description: projectData.description,
          is_active: true,
          created_by: user.id,
        })
        .select()
        .single();

      if (projectError) throw projectError;

      // The trigger should automatically add the creator as owner in project_members
      // But let's verify it worked by checking
      const { data: membership, error: memberError } = await supabase
        .from("project_members")
        .select("*")
        .eq("project_id", project.id)
        .eq("user_id", user.id)
        .single();

      if (memberError || !membership) {
        console.warn("Auto-owner trigger may not have fired, adding manually");
        // Fallback: add owner manually if trigger didn't work
        await supabase.from("project_members").insert({
          project_id: project.id,
          user_id: user.id,
          role: "owner",
        });
      }

      toast({
        title: "Success",
        description: "Project created successfully",
      });

      setCreateDialogOpen(false);
      fetchProjects(); // Refresh the list
    } catch (error: any) {
      console.error("Error creating project:", error);

      let errorMessage = error.message || "Failed to create project";

      // Handle unique constraint violations
      if (error.code === '23505') { // unique_violation
        // Check message, details, or if the stringified error contains the keywords
        // This covers cases where Supabase might wrap the error differently
        const errorString = JSON.stringify(error).toLowerCase();
        const message = error.message?.toLowerCase() || '';
        const details = error.details?.toLowerCase() || '';

        if (
          message.includes('slug') ||
          details.includes('slug') ||
          errorString.includes('projects_slug_key')
        ) {
          errorMessage = "This Project Code is already taken by another project. Please choose a unique code.";
        } else if (
          message.includes('name') ||
          details.includes('name') ||
          errorString.includes('projects_name_created_by_idx')
        ) {
          errorMessage = "You already have a project with this name.";
        } else {
          // Fallback for other unique violations
          errorMessage = "A project with this name or code already exists.";
        }
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const filteredProjects = projects.filter(project =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.slug.toLowerCase().includes(searchQuery.toLowerCase())
  );
  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Projects</h1>
            <p className="text-muted-foreground">Manage your data collection projects</p>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Project
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredProjects.length === 0 && (
          <Card className="bg-card border-border">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Database className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {searchQuery ? "No projects found" : "No projects yet"}
              </h3>
              <p className="text-muted-foreground text-center mb-6">
                {searchQuery
                  ? "Try adjusting your search terms"
                  : "Create your first project to start collecting data"}
              </p>
              {!searchQuery && (
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Project
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Projects Grid */}
        {!loading && filteredProjects.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2">
            {filteredProjects.map((project) => (
              <Card
                key={project.id}
                className="bg-card border-border hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/app/projects/${project.slug}`)}
              >
                <CardHeader className="flex flex-row items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xl">{project.name}</CardTitle>
                      <Badge variant={project.is_active ? 'default' : 'secondary'}>
                        {project.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <CardDescription>{project.description}</CardDescription>
                    <div className="flex items-center gap-2 pt-1">
                      <Badge variant="outline" className="text-xs capitalize">
                        {project.role}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Code: {project.slug}
                      </span>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/app/projects/${project.slug}`); }}>
                        View Project
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="flex items-center gap-2 text-sm">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {project.surveysCount || 0} survey{project.surveysCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Database className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">{project.submissionsCount || 0}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {project.membersCount || 0} member{project.membersCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Project Dialog */}
      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateProject}
        loading={creating}
      />
    </AppLayout>
  );
};

export default Projects;
