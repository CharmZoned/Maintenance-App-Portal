/**
 * Build-time + runtime gate for staging chrome (ribbon + role switcher).
 * Dynamic import runs only when VITE_APP_ENV is literally "staging" or "local"
 * so production bundles drop this module (ADR-0006).
 */
import { useEffect, useState, type ComponentType } from "react";
import { STAGING_TOOLS_ALLOWED } from "@/lib/env";
import type { AppRole } from "@/types.supabase";
import type { DemoRoleKey } from "@/lib/demo-accounts";
import type { StagingRibbonProps } from "./staging-ribbon";

type RibbonComponent = ComponentType<StagingRibbonProps>;

export type StagingChromeGateProps = {
  viewingRole?: AppRole | null;
  onSwitchRole?: (role: DemoRoleKey) => Promise<void>;
};

export function StagingChromeGate({ viewingRole = null, onSwitchRole }: StagingChromeGateProps) {
  const [Ribbon, setRibbon] = useState<RibbonComponent | null>(null);

  useEffect(() => {
    const env = import.meta.env.VITE_APP_ENV;
    if (env !== "staging" && env !== "local") return;
    if (!STAGING_TOOLS_ALLOWED) return;
    let cancelled = false;
    void import("./staging-ribbon").then((mod) => {
      if (!cancelled) setRibbon(() => mod.StagingRibbon);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Ribbon) return null;
  return <Ribbon viewingRole={viewingRole} onSwitchRole={onSwitchRole} />;
}
