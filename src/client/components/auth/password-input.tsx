import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Password field with Show/Hide control (Figma Auth inputs). */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  className,
  "aria-label": ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  className?: string;
  "aria-label"?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div
      className={cn(
        "flex h-11 w-full items-center gap-2 rounded-sm bg-card px-3 shadow-edge focus-within:shadow-[inset_0_0_0_1px_var(--ring),0_0_0_3px_var(--brand-tint)]",
        className,
      )}
    >
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        aria-label={ariaLabel}
        className="h-auto flex-1 border-0 bg-transparent px-0 shadow-none focus:shadow-none"
      />
      <button
        type="button"
        className="shrink-0 text-xs font-medium text-brand-text hover:underline"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}
