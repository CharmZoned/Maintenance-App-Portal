import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChoiceGroup, type ChoiceOption } from "@/components/patterns";
import {
  VISIT_WINDOWS,
  visitFromChoice,
  visitInfo,
  type VisitChoice,
  type VisitWindowId,
} from "@/lib/request-status";

const WINDOW_OPTIONS: readonly ChoiceOption<VisitWindowId | "custom">[] = [
  ...VISIT_WINDOWS.map((w) => ({
    value: w.id,
    label: w.label,
    description: formatVisitWindowHours(w.startHour, w.endHour),
  })),
  { value: "custom", label: "Custom", description: "Pick times" },
];

function formatVisitWindowHours(start: number, end: number): string {
  const h = (n: number) => String(n % 12 === 0 ? 12 : n % 12);
  return `${h(start)}–${h(end)}`;
}

/**
 * Date + arrival window for scheduling a visit (UX-17): Morning 8–12,
 * Afternoon 12–5, Evening 5–8, or a custom start and end. Controlled by a
 * `VisitChoice`; `visitFromChoice` turns it into the stored values.
 * Shows the visit the tenant will be told ("Wed 25 Nov · 8–12") under it.
 */
export function VisitWindowFields({
  value,
  onChange,
  idPrefix = "visit",
}: {
  value: VisitChoice;
  onChange: (next: VisitChoice) => void;
  idPrefix?: string;
}) {
  const stored = visitFromChoice(value);
  const error = "error" in stored && value.date ? stored.error : null;
  const info = "error" in stored ? null : visitInfo({ ...stored, status: "scheduled", assigned_staff_id: 0 });
  // Scheduling into the past is allowed (recording a visit), but say so.
  const past = info?.missed ? `${info.day} · ${info.time}` : null;
  const preview = info && !past ? info.label : "";
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-date`}>Date</Label>
        <Input
          id={`${idPrefix}-date`}
          type="date"
          className="h-11 md:h-8"
          value={value.date}
          onChange={(e) => onChange({ ...value, date: e.target.value })}
          required
        />
      </div>
      <ChoiceGroup
        label="Arrival window"
        name={`${idPrefix}-window`}
        value={value.window}
        onChange={(window) => onChange({ ...value, window })}
        options={WINDOW_OPTIONS}
        // Two by two: four segments do not fit side by side in a phone sheet.
        className="[&>div]:grid [&>div]:grid-cols-2"
      />
      {value.window === "custom" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-start`}>From</Label>
            <Input
              id={`${idPrefix}-start`}
              type="time"
              step={900}
              className="h-11 md:h-8"
              value={value.startTime}
              onChange={(e) => onChange({ ...value, startTime: e.target.value })}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${idPrefix}-error` : undefined}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-end`}>To</Label>
            <Input
              id={`${idPrefix}-end`}
              type="time"
              step={900}
              className="h-11 md:h-8"
              value={value.endTime}
              onChange={(e) => onChange({ ...value, endTime: e.target.value })}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${idPrefix}-error` : undefined}
              required
            />
          </div>
        </div>
      ) : null}
      <p
        id={`${idPrefix}-error`}
        className={
          error
            ? "text-xs leading-4 text-destructive"
            : past
              ? "text-xs font-medium leading-4 text-warning"
              : "text-xs leading-4 text-muted-foreground"
        }
        aria-live="polite"
      >
        {error ??
          (past
            ? `This window is already over (${past}). Pick a later one, unless you are recording a past visit.`
            : preview
              ? `The tenant is told: ${preview}.`
              : "The tenant is told who is coming and when.")}
      </p>
    </>
  );
}

/** The stored visit for a choice, or null when it is not complete yet. */
export function visitPatchFor(choice: VisitChoice): { scheduled_at: string; scheduled_end_at: string } | null {
  const stored = visitFromChoice(choice);
  return "error" in stored ? null : stored;
}
