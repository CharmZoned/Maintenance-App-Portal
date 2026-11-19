# ADR-0005: Who can reach staging, and how

**Status:** Accepted — owner decision, 2026-11-18: the owner plus named testers, gated
by Vercel Authentication on the existing Pro team.

## Context

Staging will offer one-click sign-in as Admin. The repository is public, so the staging
URL and the shape of the app are discoverable. The gate decides whether the one-click
buttons are a convenience or a hole.

The gate protects the staging **site**. The staging Supabase API is a separate public
endpoint; it is protected by the fact that the demo password is not published anywhere
([ADR-0006](0006-one-click-role-sign-in.md)).

## Options on Vercel

| | Who gets in | Cost | Revoking one person |
|---|---|---|---|
| **A. Vercel Authentication** | Members of the Vercel team, including free Viewer seats | Free; needs a Pro team for seats beyond the owner | Remove their seat |
| **B. Password Protection** | Anyone with the shared password | $20/month per project on Pro | Change the password for everyone |
| **C. Shareable links** | Anyone holding a link | Free | Revoke the link |
| **D. In-app unlock code** | Anyone who enters a code once per browser | Free, host-independent | Rotate the code for everyone |

## Decision

**A**, with **C** for one-off reviewers:

- Turn on Vercel Authentication (Standard Protection) so staging and all preview
  deployments require a Vercel login. Production stays public.
- Invite each tester to the Vercel team as a **Viewer** (free, read-only).
- For a reviewer who should not hold a seat, issue a shareable link and revoke it after.
- For automated browser tests and agents, use Vercel's protection-bypass token for
  automation, stored as a GitHub Actions secret.

## Consequences

- The owner's Vercel team is already on Pro, so Viewer seats for testers cost nothing
  extra.
- Named access: each tester signs in as themselves and can be removed individually.
- **Must verify during setup:** open the staging domain in a private window and confirm
  the Vercel login wall appears; confirm a Viewer seat gets through. If the staging custom
  domain turns out not to be covered by Standard Protection, fall back to **B**.
- **D** stays available as a host-independent fallback if the Vercel gate ever proves
  unsuitable; access would then be one shared code rather than named people.
