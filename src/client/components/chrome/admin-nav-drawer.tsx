import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { AdminSidebar, type AdminSidebarProps } from "./admin-sidebar";

/**
 * Admin navigation drawer (Figma "AH — Navigation drawer · Open"): the rail as
 * a 320px modal sheet from the left, used below `lg` where the rail is hidden.
 * Modal dialog — focus is trapped, Escape and the scrim ("Dismiss drawer")
 * close it, and it returns focus to the menu button. Portalled to `body`, so
 * the scrim and the sheet carry `lg-admin` themselves.
 */
export function AdminNavDrawer({
  open,
  onOpenChange,
  ...sidebar
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & Omit<AdminSidebarProps, "className" | "columnClassName">) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="lg-admin fixed inset-0 z-50 bg-muted/80 transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="lg-admin fixed inset-y-0 left-0 z-50 flex w-80 max-w-[calc(100vw-2.5rem)] transition-transform duration-200 ease-out starting:-translate-x-full motion-reduce:transition-none"
        >
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          {/* First in the DOM so it takes focus on open; drawn over the top-right corner. */}
          <DialogPrimitive.Close
            aria-label="Close navigation"
            className="absolute right-3 top-4 z-10 flex size-11 items-center justify-center rounded-sm border-2 border-ring bg-card text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-sidebar-foreground"
          >
            <X aria-hidden size={20} strokeWidth={2} absoluteStrokeWidth />
          </DialogPrimitive.Close>
          <AdminSidebar {...sidebar} className="h-full w-full" columnClassName="max-w-48" />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
