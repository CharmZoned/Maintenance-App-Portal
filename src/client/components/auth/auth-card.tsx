import type { ReactNode } from "react";
import { PORTAL_BRAND } from "@/lib/portal-nav";
import { cn } from "@/lib/utils";

/** Centered auth shell — brand + card (Figma 08 Auth). */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-10">
      {children}
    </div>
  );
}

export function AuthCard({
  title,
  children,
  className,
  wide = false,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-4 rounded-lg border border-border bg-card px-6 py-7",
        wide ? "max-w-[420px]" : "max-w-[342px]",
        className,
      )}
    >
      <div className="flex flex-col items-center">
        <p className="text-2xl font-semibold tracking-tight text-foreground">{PORTAL_BRAND}</p>
      </div>
      {title ? (
        <h1 className="text-sm font-normal text-muted-foreground">{title}</h1>
      ) : null}
      {children}
    </div>
  );
}

export function AuthField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

export function AuthNotice({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "danger" | "success" | "warning";
}) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    danger: "bg-destructive-tint text-destructive",
    success: "bg-success-tint text-success",
    warning: "bg-warning-tint text-warning",
  };
  return <div className={cn("rounded-sm px-3.5 py-3.5 text-sm", tones[tone])}>{children}</div>;
}
