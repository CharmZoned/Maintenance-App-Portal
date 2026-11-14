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
