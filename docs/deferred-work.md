# Deferred work

Track items we consciously put off. Add a row when parking work; remove or mark done when shipped.

| Task | Value / what it unlocks | Why deferred | Revisit when |
|------|-------------------------|--------------|--------------|
| Payment ledger / status **RPC tests** (record, delete, SUM vs drift, non-admin deny, direct Payment DML deny) | Catches ledger regressions before multi-staff; documents expected status math | No test harness yet; Phase 1.5 correctness shipped via RPCs + policy drops | Before multi-staff prod, or as soon as we add vitest/pgTAP (or after first live payment bug) |
| Soft-fail bootstrap / surface `generateCharges` errors via popup/toast | Admins see failed charge creation instead of silent skips | UX polish; not AuthZ; High/Must Phase 1.5 done | Next rent/charges UX pass or when charge generation is used in production |
| Dashboard / charges **N+1** query reduction | Faster dashboard + rent list under larger portfolios | Perf only; not blocking Phase 1.5 or Phase 2 DoD | When portfolio size or Lighthouse/load complaints make list latency visible |
| Service-role / SQL Editor **trigger guard** on Payments (block DML unless via RPC or explicit bypass) | Closes ledger bypass for privileged DB roles | Authenticated path already RPC-only after dropping Payment write policies; service role is ops-only today | Before granting broad SQL access to non-ops, or if ops mistakes rewrite Payments outside RPCs |
