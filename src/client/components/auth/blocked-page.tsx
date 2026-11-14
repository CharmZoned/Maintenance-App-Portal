import { Button } from "@/components/ui/button";
import { AuthCard, AuthNotice, AuthShell } from "./auth-card";

interface Props {
  title: string;
  message: string;
  onLogout: () => void;
  onRetry?: () => void;
  retryLabel?: string;
}

export function BlockedPage({ title, message, onLogout, onRetry, retryLabel = "Retry" }: Props) {
  return (
    <AuthShell>
      <AuthCard>
        <AuthNotice tone="muted">
          <h1 className="text-[15px] font-semibold text-foreground">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
        </AuthNotice>
        <p className="text-xs text-muted-foreground">
          Need help? Message Landlord Gopher from the email you signed up with.
        </p>
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <Button type="button" variant="brand" className="h-11" onClick={onRetry}>
              {retryLabel}
            </Button>
          )}
          <Button type="button" variant="outline" className="h-11" onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
