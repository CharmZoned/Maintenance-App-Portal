# Archive — legacy D1 / Hono / Clawnify

Preserved (not deleted) leftovers from the OpenProperty / Clawnify Worker path.
The live product is **Vite + Supabase** under `src/client/`; do not treat this
folder as a deployable stack.

| Path | What it was |
|------|-------------|
| `legacy-d1-hono/` | Cloudflare Worker (`index.ts` 410 stub), D1 `schema.sql`, unused `@clawnify/db` shim (`db.ts`), `wrangler.toml` |
| `clawnify/` | Clawnify `clawnify.json` + template `manifest.json` (paths inside are frozen/stale) |
| `docs/archive/` | Historical plan snapshot (`IMPLEMENTATION_PLAN.pre-wave3.md`) — separate from this Worker archive |

A r7 permission test still imports the archived 410 Worker (`index.ts` only) to
prove `/api/*` stays shut. `hono` remains a direct dependency because
`@clawnify/app` peers it and the stub imports it. There is no primary-path
deploy via Clawnify or Wrangler.
