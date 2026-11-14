# Archive — legacy D1 / Hono / Clawnify

Preserved (not deleted) leftovers from the OpenProperty / Clawnify Worker path.
The live product is **Vite + Supabase** under `src/client/`; do not treat this
folder as a deployable stack.

| Path | What it was |
|------|-------------|
| `legacy-d1-hono/` | Cloudflare Worker (`index.ts` 410 stub), D1 `schema.sql`, `@clawnify/db` shim, `wrangler.toml` |
| `clawnify/` | Clawnify `clawnify.json` + template `manifest.json` |

A r7 permission test still imports the archived 410 Worker to prove `/api/*`
stays shut. There is no primary-path deploy via Clawnify or Wrangler.
