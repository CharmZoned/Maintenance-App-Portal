import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/button";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

/**
 * Isolates a render failure in the page area so nav / sign-out stay usable.
 * Ordinary API failures still use ErrorBanner; this catches uncaught React throws.
 */
export class PortalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Portal page crashed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            This screen failed to load. The rest of the portal is still available — try again, or
            open another section from the menu.
          </p>
          <p className="max-w-lg truncate text-xs text-muted-foreground" title={this.state.error.message}>
            {this.state.error.message}
          </p>
          <Button type="button" variant="outline" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
