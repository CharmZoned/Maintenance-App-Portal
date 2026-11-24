import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ChoiceOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
}

/**
 * Segmented single choice (audit UX-03). Native radio inputs, so the group is
 * one Tab stop, arrow keys move the choice, and screen readers announce
 * "radio, 1 of 2". The segment shows a focus ring while its radio has
 * keyboard focus, and a radio dot so the choice never relies on colour alone.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  name,
  hint,
  className,
}: {
  /** Visible group label (the radiogroup's accessible name). */
  label: string;
  value: T | null;
  onChange: (value: T) => void;
  options: readonly ChoiceOption<T>[];
  /** Form field name shared by the radios. */
  name: string;
  /** Optional help text under the segments (linked with aria-describedby). */
  hint?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
      className={cn("flex w-full flex-col gap-1.5", className)}
    >
      <span id={labelId} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <div className="flex gap-2">
        {options.map((option, index) => {
          const checked = option.value === value;
          const optionId = `${id}-${index}`;
          return (
            <label
              key={option.value}
              className={cn(
                "flex min-h-11 flex-1 cursor-pointer items-start gap-2 rounded-sm border px-3 py-2.5 transition-colors duration-150",
                "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
                checked
                  ? "border-brand bg-brand-tint text-brand-text"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                aria-labelledby={`${optionId}-label`}
                aria-describedby={option.description ? `${optionId}-desc` : undefined}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                  checked ? "border-brand" : "border-muted-foreground/60",
                )}
              >
                {checked ? <span className="size-1.5 rounded-full bg-brand" /> : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span id={`${optionId}-label`} className="text-[13px] font-medium leading-tight">
                  {option.label}
                </span>
                {option.description ? (
                  <span
                    id={`${optionId}-desc`}
                    className={cn(
                      "text-xs leading-snug",
                      checked ? "text-brand-text/80" : "text-muted-foreground",
                    )}
                  >
                    {option.description}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {hint ? (
        <div id={hintId} className="flex flex-col gap-1 text-xs text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
