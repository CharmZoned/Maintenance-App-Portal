import { useApp } from "../context";
import { FloatingBanner } from "./patterns/floating-banner";

/** App-wide error message. Stays until dismissed; drawn above open dialogs. */
export function ErrorBanner() {
  const { error, setError } = useApp();
  if (!error) return null;
  return <FloatingBanner tone="error" message={error} onDismiss={() => setError(null)} />;
}
