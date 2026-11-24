import { describe, expect, it } from "vitest";
import { originLabel, readFromParam, withFrom } from "@/lib/back-link";
import { readQueueState, queueStateSearch } from "@/components/maintenance/maintenance-list";

describe("?from= back links (UX-09)", () => {
  it("adds the encoded origin path + query to a request link", () => {
    const href = withFrom("/maintenance/42", "/maintenance?tab=active&q=leak");
    expect(href).toBe("/maintenance/42?from=%2Fmaintenance%3Ftab%3Dactive%26q%3Dleak");
    expect(readFromParam(href.slice(href.indexOf("?")))).toBe("/maintenance?tab=active&q=leak");
  });

  it("replaces an existing from and keeps other params", () => {
    expect(withFrom("/maintenance/1?x=1&from=%2Fold", "/calendar?day=2026-11-25")).toBe(
      "/maintenance/1?x=1&from=%2Fcalendar%3Fday%3D2026-11-25",
    );
  });

  it("never carries an off-site origin", () => {
    expect(withFrom("/maintenance/1", "//evil.example/x")).toBe("/maintenance/1");
    expect(readFromParam("?from=https%3A%2F%2Fevil.example")).toBeNull();
    expect(readFromParam("?from=%2F%2Fevil.example")).toBeNull();
    expect(readFromParam("")).toBeNull();
  });

  it("names the screen to go back to", () => {
    expect(originLabel("/calendar?month=2026-11")).toBe("Calendar");
    expect(originLabel("/dashboard")).toBe("Dashboard");
    expect(originLabel("/properties/3")).toBe("Property");
    expect(originLabel("/maintenance?tab=all")).toBeNull();
  });
});

describe("admin queue state in the URL", () => {
  it("reads tab, property, assignee and search, ignoring junk", () => {
    expect(readQueueState("?tab=active&property=3&assignee=unassigned&q=tap")).toEqual({
      tab: "active",
      property: "3",
      assignee: "unassigned",
      query: "tap",
    });
    expect(readQueueState("?tab=bogus&property=x")).toEqual({ tab: "needs", property: "all", assignee: "all", query: "" });
  });

  it("writes only what differs from the defaults and keeps other params", () => {
    expect(queueStateSearch("", { tab: "needs", property: "all", assignee: "all", query: "" })).toBe("");
    expect(queueStateSearch("?focus=urgent", { tab: "all", property: "2", assignee: "all", query: " leak " })).toBe(
      "?focus=urgent&tab=all&property=2&q=leak",
    );
  });
});
