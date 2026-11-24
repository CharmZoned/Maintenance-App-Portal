import { describe, expect, it } from "vitest";
import {
  OFFICE_ABOUT_MAX,
  officeDraftFromSearch,
  officeMessageHref,
  officeThreadId,
  resolveStaffMessagesDeepLink,
} from "./messages";

describe("officeMessageHref", () => {
  it("opens the own office thread with no draft when there is no context", () => {
    expect(officeMessageHref()).toBe("/messages?office=me");
    expect(officeDraftFromSearch("?office=me")).toBeNull();
  });

  it("joins context parts and drops blanks", () => {
    const href = officeMessageHref({ about: ["Maple Court", null, " Unit 1A ", ""] });
    const search = href.slice(href.indexOf("?"));
    expect(officeDraftFromSearch(search)).toBe("About: Maple Court · Unit 1A\n\n");
  });

  it("caps the about text", () => {
    const href = officeMessageHref({ about: ["x".repeat(500)] });
    const draft = officeDraftFromSearch(href.slice(href.indexOf("?")));
    expect(draft).toBe(`About: ${"x".repeat(OFFICE_ABOUT_MAX)}\n\n`);
  });

  it("ignores about= without office=me", () => {
    expect(officeDraftFromSearch("?about=Maple")).toBeNull();
  });
});

describe("resolveStaffMessagesDeepLink ?office=me", () => {
  it("opens the signed-in user's own office thread", () => {
    expect(
      resolveStaffMessagesDeepLink("?office=me&about=Maple", [], { currentUserId: "u1" }),
    ).toEqual({ kind: "thread", threadId: officeThreadId("u1") });
  });

  it("is a no-op for admins and before the user is known", () => {
    expect(resolveStaffMessagesDeepLink("?office=me", [], { currentUserId: "u1", isAdmin: true })).toEqual({ kind: "none" });
    expect(resolveStaffMessagesDeepLink("?office=me", [], { currentUserId: null })).toEqual({ kind: "none" });
  });

  it("lets an explicit thread win", () => {
    expect(resolveStaffMessagesDeepLink("?office=me&thread=wo:7", [], { currentUserId: "u1" })).toMatchObject({ kind: "request", requestId: 7 });
  });
});
