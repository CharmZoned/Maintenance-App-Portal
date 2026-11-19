# CI required checks (WS-S #1)

## What runs

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)

The workflow runs on every PR into `staging` or `master`, and every push to `staging`
or `master`. It has two jobs: `typecheck / build / test` runs every time;
`release source` runs only on a pull request into `master`.

**`typecheck / build / test`** (unchanged):

1. `pnpm typecheck` (in parallel with build)
2. `pnpm build`
3. `pnpm test` (emulator suite — **must exit 0**; R6 notification cases may be `test.todo` until WS-L)

**`release source`** (new):

- Fails any pull request into `master` whose source is not the `staging` branch of
  this repository. `master` only receives the release PR from `staging`
  ([ADR-0001](../adr/0001-environments-and-promotion.md)).
- On every other pull request, and on pushes, it is skipped, which counts as passing.
- It does not stop a direct push to `master`. Branch protection does that (below).

The workflow **no longer skips docs-only changes** (the old `paths-ignore` filter for
Markdown / `docs/**` is removed). A required status check that never runs leaves a PR
unmergeable, so required checks must always report.

Job names shown in the Checks UI: **`typecheck / build / test`** and **`release source`**.
A third check, **`Supabase Preview`**, is reported by the Supabase GitHub integration, not
by this workflow.

## Make the checks required (owner action)

Branch protection cannot be set from a PR — a repo admin/owner must set it in GitHub.
This is owner action **O3** in [`docs/staging/BUILD_PLAN.md`](../staging/BUILD_PLAN.md)
(task 1.2).

1. In the repo **Settings**, change the **default branch** to `staging`, so PRs target
   it without being told.
2. Open **Settings → Branches → Branch protection rules**  
   (or **Rules → Rulesets** if the repo uses rulesets) and add a rule for each branch:

   | Branch | Required status checks | Also |
   |--------|------------------------|------|
   | `staging` | `typecheck / build / test`, `Supabase Preview` | Require a pull request before merging |
   | `master` | `typecheck / build / test`, `Supabase Preview`, `release source` | Require a pull request before merging; allowed merge method = **merge commit only** |

3. In each rule enable **Require status checks to pass before merging** and add the
   checks by their exact names (a check appears in the picker after it has reported at
   least once on a PR or on the branch).
4. Do **not** allow bypass for non-admins unless intentional.
5. Save.

Why merge commit only on `master`: squashing or rebasing a release PR makes `staging`
and `master` diverge, and every later release conflicts (ADR-0001).

Until this is set, the workflow still runs on PRs but merge is not blocked by GitHub.

## Notes

- Only require checks that always report. Do not put a path filter back on the workflow while its jobs are required.
- Do **not** require Playwright (`pnpm test:browser`) or the full dashboard run in this gate — those are slower / optional.
- R6 notification todos stay as `test.todo` until **WS-L**; they must not fail CI.
- Action versions are pinned by commit SHA in the workflow (not floating `@v4` tags alone).
- Related Auth owner click (leaked-password + min length): [`docs/ops/auth-password-policy.md`](./auth-password-policy.md).
