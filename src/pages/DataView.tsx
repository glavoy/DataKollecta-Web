import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Database,
  FolderKanban,
  ArrowRight,
  Loader2
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";

interface ProjectWithStats {
  id: string;
  name: string;
  slug: string;
  description: string;
  is_active: boolean;
  submissionsCount: number;
  formsCount: number;
}

const DataView = () => {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch projects with stats
  const { data: projects, isLoading, isError } = useQuery({
    queryKey: ["projectsWithStats"],
    queryFn: async (): Promise<ProjectWithStats[]> => {
      // Get user's projects
      const { data: memberships, error: membershipsError } = await supabase
        .from('project_members')
        .select('project_id')
        .eq('user_id', session?.user?.id);

      if (membershipsError) throw membershipsError;
      if (!memberships || memberships.length === 0) return [];

      const projectIds = memberships.map(m => m.project_id);

      // Get projects
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('id, name, slug, description, is_active')
        .in('id', projectIds);

      if (projectsError) throw projectsError;
      if (!projectsData) return [];

      // Get stats for each project
      const projectsWithStats = await Promise.all(
        projectsData.map(async (project) => {
          const { count: submissionsCount } = await supabase
            .from('submissions')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', project.id);

          const { count: formsCount } = await supabase
            .from('crfs')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', project.id);

          return {
            ...project,
            submissionsCount: submissionsCount || 0,
            formsCount: formsCount || 0,
          };
        })
      );

      return projectsWithStats;
    },
    enabled: !!session,
  });

  const filteredProjects = projects?.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.slug.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const totalRecords = projects?.reduce((sum, p) => sum + p.submissionsCount, 0) || 0;
  const totalForms = projects?.reduce((sum, p) => sum + p.formsCount, 0) || 0;

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground">Data</h1>
          <p className="text-muted-foreground">View and export collected data across all your projects</p>
        </div>

        {/* Summary Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Projects</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{projects?.length || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Forms</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalForms}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Records</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalRecords}</div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Projects with Data */}
        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
            <CardDescription>
              Select a project to view its data
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <div className="text-center py-12">
                <Database className="h-12 w-12 text-destructive mx-auto mb-3" />
                <p className="text-muted-foreground">Failed to load projects. Please try again.</p>
              </div>
            ) : filteredProjects.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-center">Forms</TableHead>
                    <TableHead className="text-center">Records</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProjects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-muted rounded">
                            <FolderKanban className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium">{project.name}</p>
                            <p className="text-sm text-muted-foreground">{project.slug}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-medium">{project.formsCount}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-medium">{project.submissionsCount}</span>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/app/projects/${project.slug}?tab=data`)}
                          className="gap-1"
                        >
                          View Data
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-12">
                <Database className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">
                  {searchTerm ? "No projects match your search." : "No projects found. Create a project to start collecting data."}
                </p>
                {!searchTerm && (
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => navigate('/app/projects')}
                  >
                    Go to Projects
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default DataView;
