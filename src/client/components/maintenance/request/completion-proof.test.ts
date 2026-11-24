import { describe, expect, it } from "vitest";
import {
  completionPhotoHint,
  completionPhotoSince,
  completionProof,
  lastReopenedAt,
  type CompletionProofEvent,
  type CompletionProofPhoto,
} from "./completion-proof";

const SAM = "user-sam";
const RILEY = "user-riley";

type Photo = CompletionProofPhoto & { id: number };

function photo(id: number, at: string, partial: Partial<Photo> = {}): Photo {
  return { id, created_at: at, uploaded_by_role: "maintenance", uploaded_by_user_id: SAM, missing: false, ...partial };
}

function ev(from: string | null, to: string, at: string): CompletionProofEvent {
  return { from_status: from, to_status: to, created_at: at };
}

const T = (h: number) => new Date(Date.UTC(2026, 10, 20, h)).toISOString();

describe("completion photo rule (mirrors protect_maintenance_request)", () => {
  it("first hold: any photo of the worker's own counts", () => {
    const r = completionProof({
      order: { accepted_at: T(9), released_at: null },
      history: [ev(null, "Open", T(8)), ev("Open", "Scheduled", T(9))],
      photos: [photo(1, T(10))],
      viewerUserId: SAM,
    });
    expect(r.need).toBe("none");
    expect(r.photos.map((p) => p.id)).toEqual([1]);
  });

  it("no photo yet: asks for the first one", () => {
    const r = completionProof({ order: { accepted_at: null, released_at: null }, history: [], photos: [], viewerUserId: SAM });
    expect(r).toMatchObject({ need: "first", since: null, photos: [] });
  });

  it("tenant photos never count", () => {
    const r = completionProof({
      order: { accepted_at: null, released_at: null },
      history: [],
      photos: [photo(1, T(10), { uploaded_by_role: "tenant", uploaded_by_user_id: "user-tina" })],
      viewerUserId: SAM,
    });
    expect(r.need).toBe("first");
  });

  it("reopened: photos from before the reopen do not prove today's fix", () => {
    const history = [ev("In Progress", "Closed", T(11)), ev("Closed", "Scheduled", T(14))];
    const before = completionProof({
      order: { accepted_at: T(9), released_at: null },
      history,
      photos: [photo(1, T(10))],
      viewerUserId: SAM,
    });
    expect(before.need).toBe("reopened");
    expect(before.since).toBe(Date.parse(T(14)));
    expect(completionPhotoHint(before.need)).toBe("This job was reopened — add a photo of today’s work.");

    const after = completionProof({
      order: { accepted_at: T(9), released_at: null },
      history,
      photos: [photo(1, T(10)), photo(2, T(15))],
      viewerUserId: SAM,
    });
    expect(after.need).toBe("none");
    expect(after.photos.map((p) => p.id)).toEqual([2]);
  });

  it("reassigned by the admin: the previous worker's photo does not count", () => {
    const r = completionProof({
      order: { accepted_at: null, released_at: T(12) },
      history: [ev("Scheduled", "Open", T(12)), ev("Open", "Scheduled", T(13))],
      photos: [photo(1, T(10))],
      viewerUserId: RILEY,
    });
    expect(r.need).toBe("reassigned");
  });

  it("released and given back: the worker's own photo from before the release does not count", () => {
    const r = completionProof({
      order: { accepted_at: null, released_at: T(12) },
      history: [],
      photos: [photo(1, T(10))],
      viewerUserId: SAM,
    });
    expect(r.need).toBe("reassigned");
    expect(
      completionProof({ order: { accepted_at: null, released_at: T(12) }, history: [], photos: [photo(2, T(13))], viewerUserId: SAM })
        .need,
    ).toBe("none");
  });

  it("assigned directly to a second worker without a release: only their own photos count", () => {
    const r = completionProof({
      order: { accepted_at: null, released_at: null },
      history: [],
      photos: [photo(1, T(10), { uploaded_by_user_id: SAM })],
      viewerUserId: RILEY,
    });
    expect(r.need).toBe("reassigned");
  });

  it("a photo whose upload failed (no file) is not proof", () => {
    const r = completionProof({
      order: { accepted_at: null, released_at: null },
      history: [],
      photos: [photo(1, T(10), { missing: true })],
      viewerUserId: SAM,
    });
    expect(r.need).toBe("first");
  });

  it("the cut-off is strict, like the server's created_at > since", () => {
    const r = completionProof({
      order: { accepted_at: T(10), released_at: null },
      history: [],
      photos: [photo(1, T(10))],
      viewerUserId: SAM,
    });
    expect(r.need).not.toBe("none");
  });

  it("reads Title Case and snake_case history statuses alike", () => {
    expect(lastReopenedAt([ev("closed", "in_progress", T(3)), ev("Closed", "Closed", T(4))])).toBe(Date.parse(T(3)));
    expect(completionPhotoSince({ accepted_at: T(5), released_at: T(2) }, [ev("Closed", "Open", T(3))])).toBe(
      Date.parse(T(5)),
    );
  });
});
