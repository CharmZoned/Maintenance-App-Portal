/**
 * Archived Cloudflare Worker entry (see archive/README.md).
 *
 * Phase 1 cutover: portfolio data is served by Supabase (Auth + PostgREST + RLS).
 * The previous unauthenticated Hono/D1 /api/* CRUD surface is retired.
 * Any request under /api returns 410 Gone so accidental Worker deploys cannot
 * expose open D1 mutations. Kept only so r7 can assert the 410 surface.
 */
import { Hono } from "hono";

/** Bindings unused — stub only returns 410/404 (no D1). */
type Env = { Bindings: Record<string, unknown> };

const app = new Hono<Env>();

const GONE = {
  error: "gone",
  message:
    "The D1 /api surface is retired. Use the Supabase-backed LG Maintenance Portal client (VITE_SUPABASE_*).",
};

app.all("/api", (c) => c.json(GONE, 410));
app.all("/api/*", (c) => c.json(GONE, 410));

app.all("*", (c) =>
  c.json(
    {
      error: "not_found",
      message: "This Worker only rejects legacy /api routes. Serve the Vite SPA separately.",
    },
    404,
  ),
);

export default app;
