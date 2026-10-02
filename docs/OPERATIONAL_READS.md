# Verified local operational reads

This is Robert's personal, single-owner account companion, not a shared-service release. This guide covers local reads used to start the app, show safety controls and reports, or revalidate a manual handoff. It does not establish permission to contact someone, provider delivery, a current backup, or a complete privacy/security certification.

## If a result cannot be verified

An apparently successful response can still contain unusable fields. The application rejects the entire affected result instead of rendering some rows, inventing counts or silently correcting it. The English/Dutch notice says that the local operational response was not verified.

- On Overview, Reports or Settings, use **Retry** / **Opnieuw proberen** in that notice. This repeats only the local read, not an earlier change. Do not reload the browser or repeat a mutation merely to recover this result.
- At startup, a malformed bootstrap/session result shows **Service unavailable** with **Try again** / **Opnieuw proberen**. This is not evidence that you were signed out or that your installation needs fresh setup. A real server-confirmed authentication refusal still offers sign-in.
- When a manual handoff's fresh read fails verification, its copy/open operation cannot proceed through that read. Inspect the error and use **Resolve latest handoff** or the appropriate [handoff recovery procedure](REQUEST_RECOVERY.md#for-the-personal-operator). Reading history is not authority to open a provider or send.
- If a settings change was accepted but its follow-up settings read cannot be verified, the message explicitly says the earlier change may already be saved. Retry the settings read before deciding whether to change anything again. The client does not submit that change automatically.

An initial Settings read must succeed before the normal-safety claim or its forms appear. During a refresh, previously loaded forms stay mounted so entered text and private-operation receipts are not discarded. The page labels old data as the last loaded result. Administrative settings controls are disabled while that read is pending or failed. This does not disable every separate privacy/password/retirement operation: those have their own permission, confirmation and recovery contracts.

Dashboard safety indicators come from the verified overview response, including its current policy acknowledgement and stop state, rather than an older sign-in snapshot. Its former automatic “SQLite + backups” and “On-device only” assurances are removed. The displayed status explicitly is not backup, privacy or provider-policy certification. Check backups through the [backup/restore verification process](OPERATOR_RUNBOOK.md#backup-and-restore); an icon is not that proof.

## Developer contract

`frontend/src/operationalReads.ts` is a pure consumed-shape guard called by the existing `api()` client **only for successful GETs**. It adds no dependencies, persistent cache, browser working-copy store, automatic retries, record normalization or backend/schema change. Extra fields remain intact. Existing body deadlines, cancellation cleanup, confirmed refusals, paged-record validators and action-specific mutation/receipt checks remain independent.

| GET resource | Checked consumed fields and boundaries |
|---|---|
| `/auth/status` | Boolean setup/demo gates and environment string. Optional setup-token gate must be boolean when supplied; optional retirement gate accepts boolean or actual SQLite `0`/`1`. Setup-required and retired cannot both be truthy. Optional absence remains backward-compatible, not proof of an omitted gate. |
| `/me` | Positive safe user/workspace IDs; renderable identity/workspace/environment strings; known local role and assisted/demo mode; nullable acknowledgement/pause text; boolean demo flag. |
| `/settings` | Workspace name, nullable acknowledgement/pause and retention integer 30–3650; provider strings, assisted mode and nullable verification time; member rows with unique positive safe IDs, renderable names/email and known roles; environment/demo fields. |
| `/overview` | Nonnegative safe counts; unique safe queue/campaign IDs and renderable fields; finite queue quality 0–100/string flags; reviewed count no greater than total; reminder/audit rows through their [existing core contracts](REQUEST_RECOVERY.md#core-paged-record-reads); boolean `local_only`, `assisted_send_only`, `compliance_acknowledged`, `paused`, `demo_mode`, with local-only and assisted-only enforced true. |
| `/reports/summary` | Total count and every consumed state aggregate; nullable aggregates preserve SQL `SUM` on empty results. Unique campaign IDs, renderable names/status, draft/outcome counts and nullable finite quality 0–100; generation text and true local-only flag. |
| `/handoffs` | Unique safe handoff IDs, safe draft IDs, provider/text/status strings and boolean permission. A supplied `draft_id` must be a single positive safe ID matching every returned row. Active URLs must be HTTPS with a host, no embedded credentials, no non-443 port, backslash or control characters. Blocked historical URL strings remain readable unchanged. |

The actual handoff GET returns `{items}` without the POST's instruction field or generic pagination metadata; the guard does not invent either requirement. Its structural URL check does not replace the backend's configured hostname, actor permission, pause/compliance, contact eligibility and latest-approved-content checks. A syntactically valid URL is not provider authorization or authenticity proof.

`useResource.load()` returns the verified result only for the latest, still-current request. Failure, supersession and unmount cannot return a result as a verified refresh. Existing last-loaded state remains available with its warning. Settings uses this result before claiming success for a change followed by a read; it does not provide generic atomic mutation confirmation or rollback.

## Evidence and remaining scope

The new regression cases exercise the actual shared client with complete fictional backend-shaped reads, then damage fields after those defaults. They cover missing/object-valued required fields, real nullable SQL history, duplicate IDs, wrong conversation targets, optional retirement representations, active versus blocked historical URLs, confirmed authentication refusals, bilingual recovery and retained settings inputs after a failed follow-up read. Earlier assertions remain; valid old fixtures are completed and Settings interactions wait for the newly required initial read.

The full browser entry includes `scripts/e2e-operational-reads.mjs`. It damages one consumed field in actual successful dashboard/report/settings/bootstrap/session GETs, then recovers actual local results through native keyboard Retry/Try again in English desktop and Dutch mobile. All four verified safety statuses remain visible, including additional 1100px checks; mobile uses a wrapping layout instead of hiding the stop or requiring horizontal safety-strip scrolling. It asserts no automatic read retries or HTTP writes, preserves nine exported record arrays and adds 22 selected accessibility scans. The [acceptance ledger](PRODUCTION_READINESS.md) distinguishes added checks, actual completed runs, failures and later source/README publication. Merely adding this test is not a passing result.

This narrows Phase009; it does not complete all API semantics, every mutation/form recovery, durable crash/reload working copies, general privacy/archive/external-copy handling, historical clock semantics, owner-installed backup/runtime checks, authenticated manual Simbi use, assistive/device acceptance, coordinated credential/history response or the license decision. No real owner database/account is changed by the fictional tests. The [full goal matrix](GOAL_COMPLETION_MATRIX.md) remains authoritative for the original scope.
