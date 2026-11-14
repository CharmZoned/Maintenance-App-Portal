# Archive — legacy D1 / Hono / Clawnify

Preserved (not deleted) leftovers from the OpenProperty / Clawnify Worker path.
The live product is **Vite + Supabase** under `src/client/`; do not treat this
folder as a deployable stack.

| Path under `archive/` | What it was |
|----------------------|-------------|
| `legacy-d1-hono/` | Cloudflare Worker 410 stub (`index.ts`), D1 `schema.sql`, `wrangler.toml`, archived unused client `api` helper |
| `clawnify/` | **STALE / frozen** Clawnify `clawnify.json` + template `manifest.json` (file lists still say `src/server/*` — those paths no longer exist; do not deploy from here) |

**Related (not under this folder):** historical plan snapshot at
[`docs/archive/IMPLEMENTATION_PLAN.pre-wave3.md`](../docs/archive/IMPLEMENTATION_PLAN.pre-wave3.md).

A r7 permission test still imports the archived 410 Worker (`legacy-d1-hono/index.ts`
only) to prove `/api/*` stays shut. `hono` remains a direct dependency because
`@clawnify/app` peers it and the stub imports it. There is no primary-path
deploy via Clawnify or Wrangler.
