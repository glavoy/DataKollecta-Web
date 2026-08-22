import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render-time crash anywhere below it and shows a fallback
 * instead of the blank white screen React otherwise unmounts to. Wraps the
 * whole app in App.tsx -- there was nothing here before, so any uncaught
 * render error (a malformed survey package, a null a page didn't guard)
 * took the entire portal down with no way back short of a manual reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-muted">
          <div className="text-center max-w-md px-4">
            <h1 className="mb-4 text-2xl font-bold">Something went wrong</h1>
            <p className="mb-6 text-muted-foreground">
              An unexpected error occurred. Reloading the page usually fixes it; if it keeps
              happening, whatever you were working on when it started is worth mentioning when
              you report it.
            </p>
            <Button onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
