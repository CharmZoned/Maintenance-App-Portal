/**
 * Pink staging ribbon — fixed at the top of every screen when staging tools are allowed.
 * Loaded only when VITE_APP_ENV is "staging" or "local".
 */
import { useEffect, useId, useRef, useState } from "react";
import {
  DEMO_ACCOUNTS,
  DEMO_ROLE_ORDER,
  demoPassword,
  formatDemoSignInError,
  type DemoRoleKey,
} from "@/lib/demo-accounts";
import { APP_ENV, STAGING_TOOLS_ALLOWED } from "@/lib/env";
import type { AppRole } from "@/types.supabase";
import { cn } from "@/lib/utils";

const RIBBON_OFFSET_VAR = "--staging-ribbon-offset";
const DEFAULT_TITLE = "LG Maintenance Portal";

declare const __STAGING_BUILD_ID__: string | undefined;
declare const __STAGING_GIT_BRANCH__: string | undefined;

function buildLabel(): string {
  const fromEnv = import.meta.env.VITE_BUILD_ID?.trim();
  const buildId =
    fromEnv || (typeof __STAGING_BUILD_ID__ === "string" ? __STAGING_BUILD_ID__ : "") || "local";
  const branch =
    import.meta.env.VITE_GIT_BRANCH?.trim() ||
    (typeof __STAGING_GIT_BRANCH__ === "string" ? __STAGING_GIT_BRANCH__ : "") ||
    "";
  if (APP_ENV === "local") {
    return `LOCAL · test data only · build ${buildId}`;
  }
  if (branch) {
    return `PREVIEW · ${branch} · build ${buildId}`;
  }
  return `STAGING · test data only · build ${buildId}`;
}

function roleKeyFromAppRole(role: AppRole | null | undefined): DemoRoleKey | null {
  if (!role) return null;
  if (role === "admin") return "admin";
  if (role === "landlord") return "landlord";
  if (role === "tenant") return "tenant";
  if (role === "maintenance") return "maintenance";
  return null;
}

export type StagingRibbonProps = {
  /** Current signed-in app role, if any. */
  viewingRole?: AppRole | null;
  onSwitchRole?: (role: DemoRoleKey) => Promise<void>;
};

export function StagingRibbon({ viewingRole = null, onSwitchRole }: StagingRibbonProps) {
  const ribbonRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const password = demoPassword();
  const currentKey = roleKeyFromAppRole(viewingRole);

  useEffect(() => {
    if (!STAGING_TOOLS_ALLOWED) return;

    const previousTitle = document.title;
    document.title = `[STAGING] ${previousTitle || DEFAULT_TITLE}`;

    let robots = document.querySelector('meta[name="robots"]');
    const createdRobots = !robots;
    if (!robots) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      document.head.appendChild(robots);
    }
    const previousRobots = robots.getAttribute("content");
    robots.setAttribute("content", "noindex, nofollow");

    return () => {
      document.title = previousTitle;
      if (createdRobots) {
        robots?.remove();
      } else if (previousRobots != null) {
        robots?.setAttribute("content", previousRobots);
      } else {
        robots?.removeAttribute("content");
      }
    };
  }, []);

  useEffect(() => {
    if (!STAGING_TOOLS_ALLOWED) return;
    const el = ribbonRef.current;
    if (!el) return;

    const apply = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty(RIBBON_OFFSET_VAR, `${height}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty(RIBBON_OFFSET_VAR);
    };
  }, []);

  if (!STAGING_TOOLS_ALLOWED) return null;

  async function switchTo(role: DemoRoleKey) {
    if (!onSwitchRole || !password) return;
    setSwitching(true);
    setSwitchError(null);
    setOpen(false);
    try {
      await onSwitchRole(role);
    } catch (err) {
      setSwitchError(formatDemoSignInError(err));
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div
      ref={ribbonRef}
      data-staging-ribbon
      role="status"
      className="fixed inset-x-0 top-0 z-[200] border-b border-pink-400 bg-pink-400 text-pink-950 shadow-sm"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-[12px] font-medium leading-tight sm:px-4">
        <p className="min-w-0 truncate font-semibold tracking-wide">{buildLabel()}</p>

        {onSwitchRole && password ? (
          <div className="relative shrink-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={menuId}
              disabled={switching}
              onClick={() => setOpen((v) => !v)}
              className={cn(
                "rounded border border-pink-700/30 bg-pink-300/80 px-2 py-0.5 text-[12px] font-semibold",
                "hover:bg-pink-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-700/40",
                "disabled:opacity-60",
              )}
            >
              {switching
                ? "Switching…"
                : currentKey
                  ? `Viewing as ${DEMO_ACCOUNTS[currentKey].roleLabel} ▾`
                  : "Switch role ▾"}
            </button>
            {open && (
              <ul
                id={menuId}
                role="menu"
                className="absolute right-0 z-[210] mt-1 min-w-[11rem] overflow-hidden rounded-md border border-pink-300 bg-white py-1 text-pink-950 shadow-md"
              >
                {DEMO_ROLE_ORDER.map((key) => (
                  <li key={key} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={key === currentKey}
                      className={cn(
                        "block w-full px-3 py-1.5 text-left text-[12px] hover:bg-pink-50",
                        key === currentKey && "bg-pink-100 font-semibold",
                      )}
                      onClick={() => void switchTo(key)}
                    >
                      {DEMO_ACCOUNTS[key].roleLabel}
                      <span className="ml-1 text-pink-800/70">· {DEMO_ACCOUNTS[key].name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
      {switchError ? (
        <p className="border-t border-pink-500/40 bg-pink-500 px-3 py-1 text-[11px] text-white sm:px-4">
          {switchError}
        </p>
      ) : null}
    </div>
  );
}
