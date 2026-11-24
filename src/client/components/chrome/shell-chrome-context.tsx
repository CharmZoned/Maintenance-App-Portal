import { createContext, useContext, type ReactNode } from "react";

export type ShellChromeValue = {
  email: string;
  role: string;
  /** Auth `user_metadata.full_name` when present — drives AccountMenu label. */
  displayName?: string | null;
  unread?: boolean;
  onNotifications?: () => void;
  onAccount?: () => void;
  onSignOut: () => void;
  /**
   * Opens the navigation drawer. Set only inside the admin workspace, where the
   * rail is hidden below `lg` — page headers show a menu button when present.
   */
  onOpenNav?: () => void;
  /**
   * Label of the active rail item ("Properties"), for the admin header's
   * "Admin workspace / {section}" breadcrumb. Set only inside the admin
   * workspace.
   */
  section?: string;
};

const ShellChromeContext = createContext<ShellChromeValue | null>(null);

export function ShellChromeProvider({
  value,
  children,
}: {
  value: ShellChromeValue;
  children: ReactNode;
}) {
  return <ShellChromeContext.Provider value={value}>{children}</ShellChromeContext.Provider>;
}

export function useShellChrome(): ShellChromeValue | null {
  return useContext(ShellChromeContext);
}
