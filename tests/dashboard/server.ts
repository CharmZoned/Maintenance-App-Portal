/**
 * Local test dashboard:  pnpm test:ui   →  http://localhost:4600
 *
 * Serves tests/dashboard/index.html, runs the suites on demand, and streams the
 * log to the page while they run.
 */
import { createServer, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DASHBOARD_PORT } from "../support/ports";
import { loadResults, ROOT, runTests, SHOTS_DIR, type Scope } from "./run";

const clients = new Set<ServerResponse>();
let running: { scope: Scope; tag: string | null; startedAt: string } | null = null;
let log: string[] = [];

function broadcast(event: string, data: unknown): void {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(frame);
}

function state() {
  return {
    registry: JSON.parse(readFileSync(join(ROOT, "tests", "requirements.json"), "utf8")),
    results: loadResults(),
    running,
    log,
  };
}

async function start(scope: Scope, tag: string | null): Promise<void> {
  running = { scope, tag, startedAt: new Date().toISOString() };
  log = [];
  broadcast("started", running);
  try {
    await runTests({
      scope,
      tag,
      onLog: (line) => {
        log.push(line);
        if (log.length > 4000) log.shift();
        broadcast("log", line);
      },
    });
  } catch (e) {
    const line = `runner crashed: ${(e as Error).message}`;
    log.push(line);
    broadcast("log", line);
  } finally {
    running = null;
    broadcast("finished", state());
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(readFileSync(join(ROOT, "tests", "dashboard", "index.html")));
  }
  if (url.pathname === "/api/state") return json(200, state());
  if (url.pathname === "/api/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (url.pathname === "/api/run" && req.method === "POST") {
    if (running) return json(409, { message: "A run is already in progress." });
    const scopeParam = url.searchParams.get("scope");
    const scope: Scope = scopeParam === "data" || scopeParam === "browser" ? scopeParam : "all";
    void start(scope, url.searchParams.get("tag"));
    return json(202, { ok: true });
  }
  if (url.pathname.startsWith("/shots/")) {
    const name = url.pathname.slice("/shots/".length);
    const file = join(SHOTS_DIR, name);
    if (/^[0-9a-f]+\.png$/.test(name) && existsSync(file)) {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=31536000, immutable" });
      return res.end(readFileSync(file));
    }
  }
  json(404, { message: "Not found" });
});

server.listen(DASHBOARD_PORT, "127.0.0.1", () => {
  console.log(`\nTest dashboard: http://localhost:${DASHBOARD_PORT}\n`);
  if (process.argv.includes("--run")) void start("all", null);
});
