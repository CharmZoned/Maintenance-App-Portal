import { describe, expect, it } from "vitest";
import { pathnameOf, splitLocation } from "./use-router";

describe("pathnameOf / splitLocation", () => {
  it("strips query and hash", () => {
    expect(pathnameOf("/maintenance?wo=12")).toBe("/maintenance");
    expect(pathnameOf("/rent?period=2026-11#x")).toBe("/rent");
    expect(pathnameOf("/calendar")).toBe("/calendar");
  });

  it("keeps search separately", () => {
    expect(splitLocation("/maintenance?wo=12")).toEqual({
      pathname: "/maintenance",
      search: "?wo=12",
    });
  });
});

describe("deep-link helpers", async () => {
  const { queryId, queryPeriod } = await import("../lib/deep-link");
  it("parses ids and periods", () => {
    expect(queryId("?wo=12", "wo")).toBe(12);
    expect(queryId("?wo=0", "wo")).toBeNull();
    expect(queryPeriod("?period=2026-11")).toBe("2026-11");
    expect(queryPeriod("?period=bad")).toBeNull();
  });
});
