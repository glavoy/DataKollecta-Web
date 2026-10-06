import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Shield, Smartphone, CloudOff } from "lucide-react";
import heroBg from "@/assets/hero-bg.jpg";

const Index = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (!loading && user) {
      navigate('/app/projects');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Simple Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-6 h-32 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="DataKollecta" className="h-28 w-auto" />
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link to="/docs">Docs</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/login">Sign In</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main>
        <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
          {/* Background Image */}
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${heroBg})` }}
          >
            <div className="absolute inset-0 bg-foreground/70" />
          </div>

          {/* Content */}
          <div className="relative z-10 container mx-auto px-6 pt-20">
            <div className="max-w-3xl mx-auto text-center">

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-accent mb-6 leading-tight">
                Collect Data Anywhere.
                <span className="block text-secondary-foreground">Manage It Everywhere.</span>
              </h1>

              <p className="text-lg md:text-xl text-accent/80 mb-8 max-w-2xl mx-auto">
                A comprehensive platform for research projects, field surveys, and clinical trials.
                Design surveys, manage teams, and ensure data integrity across offline and online environments.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
                <Button size="xl" variant="heroPrimary" asChild>
                  <Link to="/login">Sign In</Link>
                </Button>
                <Button size="xl" variant="hero" asChild>
                  <Link to="/login" state={{ isSignUp: true }}>Sign Up</Link>
                </Button>
              </div>

              {/* Feature pills */}
              <div className="flex flex-wrap items-center justify-center gap-4">
                <div className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent text-sm">
                  <CloudOff className="h-4 w-4" />
                  Offline-First
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent text-sm">
                  <Smartphone className="h-4 w-4" />
                  Mobile Ready
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent text-sm">
                  <Shield className="h-4 w-4" />
                  Secure
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Index;
