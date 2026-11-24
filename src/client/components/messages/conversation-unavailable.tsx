import { MessageSquareOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shown when a `/messages` link names a conversation the signed-in user cannot
 * open: someone else's thread, a request they cannot see, or a broken link.
 * Never a stand-in thread with a composer — writing there could only fail.
 * Same wording for every role, and it does not say whether the thing exists.
 */
export function ConversationUnavailable({
  onBack,
  backLabel = "Back to messages",
  className,
}: {
  onBack: () => void;
  backLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}
    >
      <div className="flex size-10 items-center justify-center rounded-sm bg-muted text-muted-foreground">
        <MessageSquareOff className="size-5" aria-hidden />
      </div>
      <h2 className="text-base font-semibold text-foreground">That conversation isn’t available</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        The link may be old, or the conversation may belong to someone else. Your own conversations are in your
        inbox.
      </p>
      <Button type="button" variant="secondary" size="touch" onClick={onBack}>
        {backLabel}
      </Button>
    </div>
  );
}
