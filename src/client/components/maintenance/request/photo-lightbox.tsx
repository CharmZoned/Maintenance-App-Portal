import { useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRequestDay, parseWhenDate } from "@/lib/request-status";
import { cn } from "@/lib/utils";
import type { MaintenancePhoto } from "@/types";

/**
 * Tap-to-enlarge viewer for request photos (spec §2.3 "Tap to enlarge").
 *
 * Header "Photo 1 of 2" with previous / next (hidden at the ends) and close;
 * the image on `bg-muted`; caption "Added by Tina Renter · Sat 14 Nov" plus the
 * photo's own caption. Left / right arrow keys and a horizontal swipe move
 * between photos, Esc closes, and focus goes back to the thumbnail
 * (`returnFocusTo`). A centred dialog on desktop, full screen with 44px
 * controls on phone.
 */
export interface PhotoLightboxProps {
  photos: MaintenancePhoto[];
  /** Index of the photo shown; null when closed. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
  /** Uploader's name for the caption ("Tina Renter"); falls back to their role. */
  uploaderName?: (photo: MaintenancePhoto) => string | null | undefined;
  /** Element to focus when the lightbox closes, given the index last shown (the thumbnail). */
  returnFocusTo?: (index: number) => HTMLElement | null | undefined;
}

const ROLE_FALLBACK: Record<string, string> = {
  tenant: "Tenant",
  maintenance: "Worker",
  admin: "Office",
  landlord: "Landlord",
};

/** "Sat 14 Nov", or "" for a missing / bad timestamp. */
export function photoAddedDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = parseWhenDate(iso);
  return d ? formatRequestDay(d) : "";
}

/** "Added by Tina Renter · Sat 14 Nov" (either half may be missing). */
export function photoAddedLine(photo: MaintenancePhoto, name?: string | null): string {
  const who = name?.trim() || (photo.uploaded_by_role ? ROLE_FALLBACK[photo.uploaded_by_role] : "") || "";
  const when = photoAddedDay(photo.created_at);
  if (who && when) return `Added by ${who} · ${when}`;
  if (who) return `Added by ${who}`;
  return when ? `Added ${when}` : "";
}

const SWIPE_MIN_PX = 48;

export function PhotoLightbox({ photos, index, onIndexChange, uploaderName, returnFocusTo }: PhotoLightboxProps) {
  const total = photos.length;
  const current = index !== null && index >= 0 && index < total ? index : null;
  const photo = current !== null ? photos[current] : null;
  const lastShown = useRef<number>(0);
  if (current !== null) lastShown.current = current;
  const touchStartX = useRef<number | null>(null);

  const hasPrev = current !== null && current > 0;
  const hasNext = current !== null && current < total - 1;
  const goPrev = () => hasPrev && onIndexChange(current - 1);
  const goNext = () => hasNext && onIndexChange(current + 1);

  // Warm the neighbours so stepping through feels instant.
  useEffect(() => {
    if (current === null || typeof Image === "undefined") return;
    for (const i of [current - 1, current + 1]) {
      const url = photos[i]?.url;
      if (url) new Image().src = url;
    }
  }, [current, photos]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    }
  }

  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }

  function onTouchEnd(e: TouchEvent<HTMLDivElement>) {
    const start = touchStartX.current;
    touchStartX.current = null;
    const end = e.changedTouches[0]?.clientX;
    if (start === null || end === undefined) return;
    const dx = end - start;
    if (dx <= -SWIPE_MIN_PX) goNext();
    else if (dx >= SWIPE_MIN_PX) goPrev();
  }

  const caption = photo ? photoAddedLine(photo, uploaderName?.(photo)) : "";
  const ownCaption = photo?.caption?.trim() ?? "";
  const navButton = "md:h-7 md:w-7 md:[&_svg]:size-4";

  return (
    <DialogPrimitive.Root open={photo !== null} onOpenChange={(open) => !open && onIndexChange(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/25" />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(e) => {
            const target = returnFocusTo?.(lastShown.current);
            if (target) {
              e.preventDefault();
              target.focus();
            }
          }}
          className={cn(
            // Phone: full screen, starting below the staging ribbon (0px outside staging/local).
            "fixed inset-0 top-[var(--staging-ribbon-offset,0px)] z-50 flex flex-col bg-card text-card-foreground outline-none",
            "md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[calc(100vh-3rem)] md:w-[min(60rem,calc(100vw-3rem))]",
            "md:-translate-x-1/2 md:-translate-y-1/2 md:overflow-hidden md:rounded-lg md:shadow-float",
          )}
        >
          <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border pl-4 pr-2 md:h-12">
            <DialogPrimitive.Title className="flex-1 text-[17px] leading-[22px] font-semibold">
              {current !== null ? `Photo ${current + 1} of ${total}` : "Photo"}
            </DialogPrimitive.Title>
            <Button
              type="button"
              variant="ghost"
              size="touch-icon"
              className={cn(navButton, !hasPrev && "invisible")}
              onClick={goPrev}
              disabled={!hasPrev}
              aria-hidden={!hasPrev}
              aria-label="Previous photo"
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="touch-icon"
              className={cn(navButton, !hasNext && "invisible")}
              onClick={goNext}
              disabled={!hasNext}
              aria-hidden={!hasNext}
              aria-label="Next photo"
            >
              <ChevronRight aria-hidden />
            </Button>
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="touch-icon" className={navButton} aria-label="Close">
                <X aria-hidden />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div
            className="flex min-h-0 flex-1 items-center justify-center bg-muted"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {photo ? <LightboxImage key={photo.id} photo={photo} alt={ownCaption || `Photo ${(current ?? 0) + 1}`} /> : null}
          </div>

          <DialogPrimitive.Description asChild>
            <div className="shrink-0 space-y-0.5 px-4 py-3 text-xs leading-4 text-muted-foreground pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3">
              {caption ? <p>{caption}</p> : null}
              {ownCaption ? <p className="text-foreground">{ownCaption}</p> : null}
              {!caption && !ownCaption ? <p>Request photo</p> : null}
            </div>
          </DialogPrimitive.Description>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function LightboxImage({ photo, alt }: { photo: MaintenancePhoto; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!photo.url || failed) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center text-sm leading-5 text-muted-foreground">
        <ImageIcon className="size-6" aria-hidden />
        <p>This photo couldn&rsquo;t be loaded.</p>
      </div>
    );
  }
  return (
    <img
      src={photo.url}
      alt={alt}
      onError={() => setFailed(true)}
      className="max-h-full w-auto max-w-full object-contain md:max-h-[80vh]"
    />
  );
}
