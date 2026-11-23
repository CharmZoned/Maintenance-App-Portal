import type { ButtonHTMLAttributes, ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  documentAudienceLine,
  type LandlordDocumentRowModel,
} from "@/lib/landlord-documents";
import { cn } from "@/lib/utils";

/**
 * Landlord document row (Figma `2037:560` desktop, `2037:705` phone).
 *
 * Read-only. Download is the only action this pattern performs. Pass `menu`
 * (usually `LandlordDocumentMenuButton`) when a later screen owns extra
 * actions for a file the viewer uploaded. Do not put upload or delete here.
 *
 * Set `showScope` false on a property tab whose section heading already says
 * "WHOLE BUILDING" or "UNIT 1A" (Figma `2049:6169`).
 */
export function LandlordDocumentRow({
  model,
  showScope = true,
  onDownload,
  downloading = false,
  menu,
  className,
}: {
  model: LandlordDocumentRowModel;
  showScope?: boolean;
  onDownload: () => void;
  downloading?: boolean;
  menu?: ReactNode;
  className?: string;
}) {
  const audienceLine = documentAudienceLine(model.scopeLabel, model.audienceLabel, showScope);
  return (
    <div className={cn("rounded-sm border border-border bg-card p-4", className)}>
      <div className="md:hidden">
        <div className="flex items-start gap-4">
          <FileKindMark kind={model.fileKind} />
          <div className="min-w-0 flex-1">
            <Title title={model.title} />
            <KindBadge badge={model.badge} />
          </div>
        </div>
        <p className="mt-3 lg-caption text-foreground">{audienceLine}</p>
        <UploadedLine line={model.uploadedLine} className="mt-2" />
        <div className="mt-3">
          <RowActions
            title={model.title}
            onDownload={onDownload}
            downloading={downloading}
            menu={menu}
          />
        </div>
      </div>

      <div className="hidden md:grid md:grid-cols-[2.5rem_minmax(0,23rem)_12.5rem_minmax(0,1fr)] md:items-start md:gap-x-4">
        <FileKindMark kind={model.fileKind} />
        <div className="min-w-0">
          <Title title={model.title} />
          <KindBadge badge={model.badge} />
        </div>
        <div>
          {showScope ? <p className="lg-body-medium text-foreground">{model.scopeLabel}</p> : null}
          <p className="lg-caption text-muted-foreground">Shared with</p>
          <p className="lg-caption text-muted-foreground">{model.audienceLabel}</p>
        </div>
        <div className="row-span-2 self-center justify-self-end">
          <RowActions
            title={model.title}
            onDownload={onDownload}
            downloading={downloading}
            menu={menu}
          />
        </div>
        <UploadedLine line={model.uploadedLine} className="col-span-2 col-start-2 mt-1.5" />
      </div>
    </div>
  );
}

/**
 * 44px overflow control from the "I shared" row (`2037:596`). The menu's
 * contents belong to the screen that owns the action.
 */
export function LandlordDocumentMenuButton({
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Button
      variant="ghost"
      size="touch-icon"
      className={className}
      {...props}
      type="button"
      aria-label={label}
    >
      <MoreHorizontal aria-hidden />
    </Button>
  );
}

function FileKindMark({ kind }: { kind: string }) {
  return (
    <span
      className="flex h-12 w-10 shrink-0 items-center justify-center rounded-sm bg-muted text-center lg-label text-muted-foreground"
      aria-hidden
    >
      {kind}
    </span>
  );
}

function Title({ title }: { title: string }) {
  return <p className="truncate lg-body-medium text-foreground">{title}</p>;
}

function KindBadge({ badge }: { badge: string }) {
  return (
    <div className="mt-2">
      <Badge variant="neutral">{badge}</Badge>
    </div>
  );
}

function UploadedLine({ line, className }: { line: string; className?: string }) {
  if (!line) return null;
  return <p className={cn("truncate lg-caption text-muted-foreground", className)}>{line}</p>;
}

function RowActions({
  title,
  onDownload,
  downloading,
  menu,
}: {
  title: string;
  onDownload: () => void;
  downloading: boolean;
  menu?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="touch"
        className="w-[120px] md:w-[108px]"
        onClick={onDownload}
        disabled={downloading}
        aria-busy={downloading || undefined}
        aria-label={`Download ${title}`}
      >
        Download
      </Button>
      {menu}
    </div>
  );
}
