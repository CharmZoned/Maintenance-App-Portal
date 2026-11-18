# Architecture decision records

One file per decision. Each records the context, the options considered, the choice, and
what follows from it. Once a decision is **Accepted**, do not edit its substance — write a
new ADR that supersedes it.

**Status values:** `Proposed` (needs an owner decision) · `Accepted` · `Superseded by NNNN`

| # | Title | Status |
|---|---|---|
| [0001](0001-environments-and-promotion.md) | Environments and promotion flow | Accepted |
| [0002](0002-ui-hosting.md) | UI hosting on Vercel | Accepted |
| [0003](0003-staging-database.md) | Staging database: rebuild, repair, or separate project | Accepted |
| [0004](0004-database-promotion.md) | Promoting database changes to production | Accepted |
| [0005](0005-staging-access-gate.md) | Who can reach staging, and how | Accepted |
| [0006](0006-one-click-role-sign-in.md) | One-click role sign-in on staging | Accepted |
| [0007](0007-staging-data-and-seeding.md) | Staging data and seeding | Accepted |
| [0008](0008-pr-previews.md) | Per-pull-request preview sites | Accepted |
| [0009](0009-schema-ownership.md) | Schema ownership across portal and website | Accepted |
| [0010](0010-repository-visibility.md) | Repository visibility | Accepted |

Overview: [`docs/staging/DESIGN_PLAN.md`](../staging/DESIGN_PLAN.md) · Build steps:
[`docs/staging/BUILD_PLAN.md`](../staging/BUILD_PLAN.md).
