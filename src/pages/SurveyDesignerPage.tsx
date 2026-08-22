import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import SurveyDesigner from "@/components/survey-designer/SurveyDesigner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { surveyService } from "@/services/surveyService";
import { SurveyPackage } from "@/types/survey";

const SurveyDesignerPage = () => {
  const { slug, surveyId } = useParams<{ slug: string; surveyId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [initialPackage, setInitialPackage] = useState<SurveyPackage | undefined>(undefined);
  const [serverUpdatedAt, setServerUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Which survey (or 'new') the currently-loaded/loading package belongs to.
  // Lets the load effect tell "the route actually changed, we need a fresh
  // package" apart from "a dependency object was merely re-identitied" --
  // the latter must never blow away an in-progress edit.
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    const routeKey = `${slug ?? ''}:${surveyId ?? 'new'}`;
    const initialize = async () => {
      if (!user || !slug) return;
      if (loadedForRef.current === routeKey) return; // same survey, re-run triggered by an identity change only
      const isRouteChange = loadedForRef.current !== null;

      try {
        setLoading(true);
        loadedForRef.current = routeKey;
        // A genuine navigation to a different survey must not leave the
        // previous one's package on screen while the new one loads -- only
        // clear it here, though, never on a same-survey re-run (that's the
        // exact clobber this whole page is being fixed to avoid).
        if (isRouteChange) setInitialPackage(undefined);

        // 1. Fetch project ID from slug
        const { data: projectData, error: projectError } = await supabase
          .from('projects')
          .select('id, name')
          .eq('slug', slug)
          .single();

        if (projectError) {
          if (projectError.code === 'PGRST116') {
            toast({
              title: "Project not found",
              description: "This project doesn't exist or you don't have access to it.",
              variant: "destructive",
            });
            navigate('/app/projects');
            return;
          }
          throw projectError;
        }

        const pid = projectData.id;
        setProjectId(pid);

        // 2. Load Survey Package
        if (surveyId) {
          // Edit existing survey
          try {
            const { pkg, serverUpdatedAt: updatedAt } = await surveyService.getSurveyPackage(surveyId);
            setInitialPackage(pkg);
            setServerUpdatedAt(updatedAt);
          } catch (err) {
            console.error('Error loading survey:', err);
            toast({
              title: "Error",
              description: "Failed to load the requested survey.",
              variant: "destructive",
            });
            navigate(`/app/projects/${slug}`);
          }
        } else {
          // Create New Survey - Start Fresh
          setInitialPackage({
            id: crypto.randomUUID(),
            surveyId: '', // Logical ID (e.g. filename base), user should set this
            name: `${projectData.name} Survey`,
            forms: []
          });
          setServerUpdatedAt(null);
        }

      } catch (error: any) {
        console.error('Error initializing designer:', error);
        toast({
          title: "Error",
          description: "Failed to initialize survey designer.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    initialize();
    // user?.id, not user -- AuthContext still hands out a new `user` object
    // reference on some events even after its own identity-comparison fix,
    // and this effect has no business re-running for the same person.
  }, [slug, surveyId, user?.id]);

  // Only the very first load (no package yet) should show the full-page
  // spinner. If this effect is ever re-triggered while a package is already
  // on screen, gate on `loadedForRef` above keeps it a no-op -- but even if
  // that guard were somehow bypassed, this stops `loading` from unmounting
  // `<SurveyDesigner>` and destroying whatever the user was mid-edit on.
  if (loading && !initialPackage) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="h-[calc(100vh-8rem)]">
        <SurveyDesigner
          projectId={projectId}
          projectSlug={slug}
          userId={user?.id}
          initialPackage={initialPackage}
          serverUpdatedAt={serverUpdatedAt}
          surveyRecordId={surveyId}
        />
      </div>
    </AppLayout>
  );
};

export default SurveyDesignerPage;
