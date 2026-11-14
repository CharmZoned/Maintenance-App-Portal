import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { displayNameFromEmail, initialsFromName, roleLabel } from "@/lib/portal-nav";

/**
 * Account trigger + menu (Figma Account menu). Sign out lives here — the old
 * email/role strip is retired.
 */
export function AccountMenu({
  email,
  role,
  onAccount,
  onSignOut,
  className,
}: {
  email: string;
  role: string;
  onAccount?: () => void;
  onSignOut: () => void;
  className?: string;
}) {
  const name = displayNameFromEmail(email);
  const initials = initialsFromName(name);
  const label = roleLabel(role);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${name}`}
          className={cn(
            "flex h-9 shrink-0 items-center gap-2 rounded-sm bg-muted pl-2 pr-2.5 text-left hover:bg-accent",
            className,
          )}
        >
          <span className="flex size-[22px] items-center justify-center rounded-full bg-brand text-[0.625rem] font-semibold text-on-brand">
            {initials}
          </span>
          <span className="hidden max-w-[9rem] truncate text-[0.8125rem] font-medium text-foreground sm:inline">
            {name}
          </span>
          <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px] rounded-md p-0 py-2">
        <div className="flex flex-col gap-0.5 px-3 py-2">
          <div className="text-sm font-semibold text-foreground">{name}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="truncate text-xs text-faint">{email}</div>
        </div>
        <DropdownMenuSeparator className="my-0" />
        {onAccount ? (
          <DropdownMenuItem
            className="rounded-none px-3 py-2.5 text-sm"
            onSelect={() => onAccount()}
          >
            Account
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          className="rounded-none px-3 py-2.5 text-sm text-destructive focus:text-destructive"
          onSelect={() => onSignOut()}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
