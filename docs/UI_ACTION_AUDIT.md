# UI action audit

Audited 2026-08-08. Every visible control below is wired to a route, local state change, download, or explicit external browser action. No disabled future/placeholder control is shown.

The inventory below is historical, not a current all-role acceptance result. The 2026-09-05 follow-ups repaired misleading viewer actions and modal keyboard behavior, added a fictional local sent/reply/reminder/report browser journey, and separately verified the app's public Simbi homepage handoff/Back/Not sent path; see [the current production acceptance ledger](PRODUCTION_READINESS.md). A wired action or successful public-page navigation is not automatically a verified messaging integration. Authenticated provider operation and the complete role/accessibility audit remain separate gates.

| Surface | Action | Result and guard |
|---|---|---|
| First run | Create workspace | Creates owner/workspace/provider-link records and authenticated session. Fails after first owner exists. |
| Sign in | Sign in / sign out | Creates or removes opaque local session; errors stay truthful. |
| Sidebar | 10 navigation items | Each opens a real product route. |
| Top bar | Help | Opens a real in-product operator guide with the critical path and reference documentation. |
| Dashboard | Review drafts / queue / campaigns / reminders / audit | Navigates to the corresponding operational page. Empty states describe the real next action. |
| Prospects | Search | Server-side bounded search with fixed sort. |
| Prospects | Add prospect | Validates HTTPS URL, provider, consent state, and unique provider/source pair. |
| Prospects | Import CSV | Preview validates every row; commit is atomic and skips exact duplicates. |
| Prospects | Open source | Explicit new browser tab; the backend never fetches the URL. |
| Campaigns | Create | Stores purpose, lawful context, daily limit, and cooldown as draft. |
| Campaigns | Activate / pause / archive | Server-authorized transitions; activation requires compliance acknowledgement. |
| Templates | Create | Validates only four allowed placeholders; no fake AI is invoked. |
| Review | Prepare draft | Deterministically renders selected campaign/prospect/template and enters review. |
| Review | Select/edit/save | Loads real record; editing resets approval and quality signals. |
| Review | Decline / approve | State-machine transition; approval requires all safety checks and an unpaused compliant workspace. |
| Review | Copy and open provider | Creates idempotent, limited, cooldown-checked handoff; copies only on explicit click and opens approved same-host URL. |
| Handoff | Not sent / ambiguous / sent manually | Records exact local result; never infers provider success. |
| Ambiguous draft | Resolve latest handoff | Reloads persisted handoff and asks operator to verify provider before recording. |
| Replies | Record reply | Only valid after sent/prepared/ambiguous state; moves draft to replied and cancels reminders. |
| Reminders | Create / done | Local-only state; never schedules a send. |
| Reports | Refresh | Recalculates local funnel and campaign outcome summaries. |
| Audit | View | Read-only event metadata; minimized new entries, but legacy details may contain personal text. Separate historical cleanup preserves core event identity/chronology; no arbitrary edit/delete control. |
| Settings | Compliance acknowledgement | Owner/admin only; requires all current-policy confirmations. |
| Settings | Safety stop / resume | Owner/admin only; blocks approvals and handoffs without hiding investigation data. |
| Settings | Provider save | Owner/admin only; HTTPS link only, assisted mode fixed, credentials rejected by design. |
| Settings | Export | Owner/admin-only full workspace JSON; intentionally sensitive. Viewers/editors receive guidance, not a download action. |
| Settings | Privacy cleanup | Owner only: contact/age-based history, campaign or reusable-template scope; search/paging, exact names/counts, acknowledgement/password and verified backup. Age-based scan has explicit continuation/restart, page-only counts and protected oversized/invalid histories; batches retain the cursor, Next cannot skip selected contacts. Campaign identities remain restricted; template removal preserves drafts/approval. Cancel clears credentials; changed/unverified previews fail closed; only exact validated kind/plan/counts/file/time/replay receipts claim completion, and interrupted responses keep safe same-plan retry. Displayed opaque references support owner-only older-receipt lookup after reload; a missing receipt is not failed-removal proof and lookup never replaces a pending preview. |
| Settings | Minimize old audit details | Owner only: exact old event IDs/known field names, scan-page counts/continuation, acknowledgement/current local password and verified pre-change backup. No event deletion; core evidence/operational restrictions/settings remain. Cancel clears secrets; stale plans fail closed; wrong-plan responses cannot claim success; same-plan retry/reload recover typed audit receipts. |
| Settings | Support data | Owner/admin-only redacted diagnostic JSON; other roles receive guidance. |
| Settings | Retire personal installation | Sole owner/one workspace only; stop first, exact count/name preview, two acknowledgements, RETIRE and current password, verified paused backup. Cancel preserves data; receipt verifies completion; private UI removed, sibling tabs refresh, reload blocks sign-in/setup. External copies and Simbi unchanged. |
| Settings | Add member | Owner/admin only; scrypt password and constrained role. |

Accessibility controls include semantic headings, labels, table headers, focus-visible states, keyboard-operable buttons/links, dialog roles, status announcements, reduced-motion handling, and responsive navigation. Browser evidence at 1440x1000 and 390x844 is recorded in `FINAL_VERIFICATION_REPORT.md`.
