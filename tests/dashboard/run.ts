/**
 * Runs the test suites and turns their output into one results file the
 * dashboard reads (tests/.results/latest.json) plus a self-contained HTML
 * report (tests/.results/report.html).
 *
 *   tsx tests/dashboard/run.ts              run everything
 *   tsx tests/dashboard/run.ts data         unit + requirement + workflow tests (vitest)
 *   tsx tests/dashboard/run.ts browser      browser tests (Playwright)
 *   tsx tests/dashboard/run.ts all R4       only tests tagged [R4]
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../..");
export const RESULTS_DIR = join(ROOT, "tests", ".results");
export const SHOTS_DIR = join(RESULTS_DIR, "shots");
const LATEST = join(RESULTS_DIR, "latest.json");
const VITEST_JSON = join(RESULTS_DIR, "vitest.json");
const PLAYWRIGHT_JSON = join(RESULTS_DIR, "playwright.json");

export type Scope = "all" | "data" | "browser";
export type Status = "passed" | "failed" | "todo" | "skipped";
export type Layer = "unit" | "data" | "browser";

export interface TestRecord {
  id: string;
  layer: Layer;
  file: string;
  /** describe() titles above the test, tags removed. */
  group: string[];
  title: string;
  /** Requirement / workflow ids found in the titles, e.g. ["R4"] or ["WF1"]. */
  tags: string[];
  status: Status;
  durationMs: number;
  error: string | null;
  shots: { name: string; file: string }[];
  /** Position within its file, so workflow steps keep their order. */
  order: number;
}

export interface RunSummary {
  scope: Scope;
  tag: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  git: { branch: string; commit: string };
  suites: { id: "data" | "browser"; ok: boolean; note: string | null }[];
}

export interface Results {
  lastRun: RunSummary | null;
  tests: TestRecord[];
}

const TAG = /\[([A-Z]+\d+)\]/g;
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const untag = (s: string) => s.replace(TAG, "").replace(/\s+/g, " ").trim();

function layerOf(file: string): Layer {
  if (file.startsWith("tests/e2e/")) return "browser";
  if (file.startsWith("tests/requirements/") || file.startsWith("tests/workflows/")) return "data";
  return "unit";
}

function record(file: string, ancestors: string[], title: string, order: number): Omit<TestRecord, "status" | "durationMs" | "error" | "shots"> {
  const full = [...ancestors, title].join(" > ");
  const tags = [...new Set([...full.matchAll(TAG)].map((m) => m[1]))];
  const layer = layerOf(file);
  return {
    id: `${layer}:${file}:${full}`,
    layer,
    file,
    group: ancestors.map(untag).filter(Boolean),
    title: untag(title),
    tags,
    order,
  };
}

/** First meaningful lines of a failure, without stack frames. */
function tidyError(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const text = stripAnsi(raw).split(/\n\s*Call log:/)[0];
  const lines = text
    .split("\n")
    .filter((l) => !/^\s+at\s/.test(l) && !/^\s*(Timeout: \d+ms|Error: element\(s\) not found)\s*$/.test(l))
    .map((l) => l.replace(/^(AssertionError|Error): /, ""));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1200) || null;
}

function readVitest(): TestRecord[] {
  if (!existsSync(VITEST_JSON)) return [];
  const json = JSON.parse(readFileSync(VITEST_JSON, "utf8")) as {
    testResults: {
      name: string;
      message?: string;
      assertionResults: {
        ancestorTitles: string[];
        title: string;
        status: string;
        duration?: number | null;
        failureMessages?: string[];
      }[];
    }[];
  };
  const out: TestRecord[] = [];
  for (const fileResult of json.testResults) {
    const file = relative(ROOT, fileResult.name).split("\\").join("/");
    fileResult.assertionResults.forEach((a, i) => {
      const status: Status =
        a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : a.status === "todo" ? "todo" : "skipped";
      out.push({
        ...record(file, a.ancestorTitles, a.title, i),
        status,
        durationMs: Math.round(a.duration ?? 0),
        error: status === "failed" ? tidyError((a.failureMessages ?? []).join("\n")) : null,
        shots: [],
      });
    });
  }
  return out;
}

interface PwSuite {
  title: string;
  file?: string;
  specs?: {
    title: string;
    file: string;
    tests: {
      status: string;
      results: {
        status: string;
        duration: number;
        error?: { message?: string };
        attachments?: { name: string; contentType: string; path?: string; body?: string }[];
      }[];
    }[];
  }[];
  suites?: PwSuite[];
}

function readPlaywright(): TestRecord[] {
  if (!existsSync(PLAYWRIGHT_JSON)) return [];
  const json = JSON.parse(readFileSync(PLAYWRIGHT_JSON, "utf8")) as { suites: PwSuite[] };
  const out: TestRecord[] = [];
  const counters = new Map<string, number>();
  const walk = (suite: PwSuite, ancestors: string[], depth: number) => {
    // depth 0 is the file-level suite; its title is the file name.
    const here = depth === 0 ? ancestors : [...ancestors, suite.title];
    for (const spec of suite.specs ?? []) {
      const file = `tests/e2e/${spec.file}`;
      const order = counters.get(file) ?? 0;
      counters.set(file, order + 1);
      const test = spec.tests[0];
      const result = test?.results[test.results.length - 1];
      const status: Status = !result || result.status === "skipped" ? "skipped" : result.status === "passed" ? "passed" : "failed";
      const shots: TestRecord["shots"] = [];
      for (const att of result?.attachments ?? []) {
        if (att.contentType !== "image/png") continue;
        const bytes = att.body ? Buffer.from(att.body, "base64") : att.path && existsSync(att.path) ? readFileSync(att.path) : null;
        if (!bytes) continue;
        const name = `${createHash("sha1").update(bytes).digest("hex").slice(0, 16)}.png`;
        writeFileSync(join(SHOTS_DIR, name), bytes);
        shots.push({ name: att.name === "screenshot" ? "At the moment it failed" : att.name, file: name });
      }
      out.push({
        ...record(file, here, spec.title, order),
        status,
        durationMs: Math.round(result?.duration ?? 0),
        error: status === "failed" ? tidyError(result?.error?.message) : null,
        shots,
      });
    }
    for (const child of suite.suites ?? []) walk(child, here, depth + 1);
  };
  for (const s of json.suites) walk(s, [], 0);
  return out;
}

function sh(cmd: string, args: string[], env: Record<string, string>, onLog: (line: string) => void): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0", ...env } });
    const pipe = (chunk: Buffer) => {
      for (const line of stripAnsi(chunk.toString("utf8")).split("\n")) if (line.trim()) onLog(line);
    };
    child.stdout.on("data", pipe);
    child.stderr.on("data", pipe);
    child.on("close", (code) => resolveExit(code ?? 1));
    child.on("error", (e) => {
      onLog(`could not start ${cmd}: ${e.message}`);
      resolveExit(1);
    });
  });
}

async function capture(cmd: string, args: string[]): Promise<string> {
  let out = "";
  await sh(cmd, args, {}, (l) => (out += l));
  return out.trim();
}

export function loadResults(): Results {
  if (!existsSync(LATEST)) return { lastRun: null, tests: [] };
  return JSON.parse(readFileSync(LATEST, "utf8")) as Results;
}

export async function runTests(opts: {
  scope: Scope;
  tag?: string | null;
  onLog?: (line: string) => void;
  /** Re-read the raw output of the previous run instead of running again. */
  reuseOutput?: boolean;
}): Promise<Results> {
  const onLog = opts.onLog ?? ((l) => console.log(l));
  const tag = opts.tag && /^[A-Z]+\d+$/.test(opts.tag) ? opts.tag : null;
  mkdirSync(SHOTS_DIR, { recursive: true });
  const previous = loadResults();
  const started = Date.now();
  const suites: RunSummary["suites"] = [];
  let fresh: TestRecord[] = [];

  if (opts.scope === "all" || opts.scope === "data") {
    if (!opts.reuseOutput) {
      rmSync(VITEST_JSON, { force: true });
      onLog(`▶ Data-layer tests (vitest)${tag ? ` — only [${tag}]` : ""}`);
      const args = ["exec", "vitest", "run", "--reporter=default", "--reporter=json", `--outputFile.json=${VITEST_JSON}`];
      if (tag) args.push("-t", `\\[${tag}\\]`);
      await sh("pnpm", args, {}, onLog);
    }
    const got = readVitest();
    suites.push({ id: "data", ok: got.length > 0, note: got.length ? null : "vitest produced no results — see the log" });
    fresh = fresh.concat(got);
  }

  if (opts.scope === "all" || opts.scope === "browser") {
    if (!opts.reuseOutput) {
      rmSync(PLAYWRIGHT_JSON, { force: true });
      onLog(`▶ Browser tests (Playwright)${tag ? ` — only [${tag}]` : ""}`);
      const args = ["exec", "playwright", "test", "--trace", "off", "--reporter=list,json"];
      if (tag) args.push("-g", `\\[${tag}\\]`);
      await sh("pnpm", args, { PLAYWRIGHT_JSON_OUTPUT_NAME: PLAYWRIGHT_JSON }, onLog);
    }
    const got = readPlaywright();
    suites.push({ id: "browser", ok: got.length > 0, note: got.length ? null : "Playwright produced no results — see the log" });
    fresh = fresh.concat(got);
  }

  // Merge: a full run of a layer replaces that layer; a filtered run only
  // overwrites the tests that actually ran.
  const ranLayers = new Set<Layer>();
  if (opts.scope !== "browser") ["unit", "data"].forEach((l) => ranLayers.add(l as Layer));
  if (opts.scope !== "data") ranLayers.add("browser");
  const byId = new Map(previous.tests.map((t) => [t.id, t]));
  if (!tag) for (const t of previous.tests) if (ranLayers.has(t.layer)) byId.delete(t.id);
  for (const t of fresh) {
    if (tag && t.status === "skipped" && byId.has(t.id)) continue;
    byId.set(t.id, t);
  }

  const results: Results = {
    lastRun: {
      scope: opts.scope,
      tag,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      git: {
        branch: await capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
        commit: await capture("git", ["rev-parse", "--short", "HEAD"]),
      },
      suites,
    },
    tests: [...byId.values()],
  };
  writeFileSync(LATEST, JSON.stringify(results, null, 1));
  writeStaticReport(results);
  const failed = results.tests.filter((t) => t.status === "failed").length;
  onLog(`■ Done: ${results.tests.filter((t) => t.status === "passed").length} passed, ${failed} failed, ${results.tests.filter((t) => t.status === "todo").length} planned`);
  return results;
}

/** One self-contained HTML file (data + screenshots inlined) that opens without a server. */
export function writeStaticReport(results: Results): string {
  const template = readFileSync(join(HERE, "index.html"), "utf8");
  const shots: Record<string, string> = {};
  for (const t of results.tests) {
    for (const s of t.shots) {
      const p = join(SHOTS_DIR, s.file);
      if (!shots[s.file] && existsSync(p)) shots[s.file] = `data:image/png;base64,${readFileSync(p).toString("base64")}`;
    }
  }
  const payload = {
    registry: JSON.parse(readFileSync(join(ROOT, "tests", "requirements.json"), "utf8")),
    results,
    shots,
  };
  const html = template.replace(
    '<script id="embedded" type="application/json">null</script>',
    () => `<script id="embedded" type="application/json">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>`,
  );
  const out = join(RESULTS_DIR, "report.html");
  writeFileSync(out, html);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [scopeArg, tagArg] = process.argv.slice(2);
  const scope: Scope = scopeArg === "data" || scopeArg === "browser" ? scopeArg : "all";
  // `report` rebuilds latest.json + report.html from the previous run's raw output.
  const results = await runTests({ scope, tag: tagArg ?? null, reuseOutput: scopeArg === "report" });
  console.log(`\nReport: ${relative(ROOT, join(RESULTS_DIR, "report.html"))}`);
  // Failing tests are findings, not a crash — but CI still needs a signal.
  process.exit(results.tests.some((t) => t.status === "failed") ? 1 : 0);
}
