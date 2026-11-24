import { X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdminButton } from "./dashboard-primitives";

/**
 * The office shortcuts in the Quick add menu, in Figma order
 * ("AD / Quick add menu"). Ids are stable: the page maps them to routes and
 * dialogs. The design's "New listing" is left out until listings can be
 * published from the portal: every entry here must do what it says.
 */
export const QUICK_ADD_ACTIONS = [
  { id: "add-property", label: "Add property" },
  { id: "add-tenant", label: "Add tenant" },
  { id: "record-payment", label: "Record payment" },
  { id: "upload-document", label: "Upload document" },
  { id: "new-message", label: "New message" },
] as const satisfies readonly { id: string; label: string }[];

export type QuickAddActionId = (typeof QUICK_ADD_ACTIONS)[number]["id"];

/**
 * "Quick add" button and its menu (Figma "AD / Quick add menu" and the
 * "Quick add open" frame): a 260px panel of 44px shortcuts with a
 * "Dismiss Quick add" close button beside it. The menu portals to `body`, so
 * its content carries the `lg-admin` scope.
 */
export function QuickAddMenu({
  onSelect,
  defaultOpen,
}: {
  /** Called with the id of the chosen entry in QUICK_ADD_ACTIONS. */
  onSelect: (actionId: QuickAddActionId) => void;
  /** Preview/testing only: render the menu open on mount. */
  defaultOpen?: boolean;
}) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <AdminButton variant="outline" className="min-w-[8.25rem]">
          Quick add
        </AdminButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        collisionPadding={16}
        aria-label="Quick add"
        className="lg-admin flex max-w-[calc(100vw-2rem)] items-start gap-2 overflow-visible rounded-none bg-transparent p-0 shadow-none outline-none"
      >
        <DropdownMenuGroup className="flex w-[260px] min-w-0 flex-col gap-1 rounded-md border border-border bg-popover p-2">
          {QUICK_ADD_ACTIONS.map((action) => (
            <DropdownMenuItem
              key={action.id}
              onSelect={() => onSelect(action.id)}
              className="min-h-11 cursor-pointer gap-3 px-3 py-0 font-medium leading-[1.375rem] text-foreground"
            >
              <span className="min-w-0 flex-1 break-words">{action.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuItem
          aria-label="Dismiss Quick add"
          className="size-11 shrink-0 cursor-pointer justify-center border border-border bg-card p-0 text-foreground focus:border-ring [&_svg]:size-5"
        >
          <X aria-hidden strokeWidth={2} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
