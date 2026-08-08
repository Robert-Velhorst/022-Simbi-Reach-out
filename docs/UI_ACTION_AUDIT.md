# UI action audit

Audited 2026-08-08. Every visible control below is wired to a route, local state change, download, or explicit external browser action. No disabled future/placeholder control is shown.

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
| Audit | View | Reads append-only event metadata; no body/credential display. |
| Settings | Compliance acknowledgement | Owner/admin only; requires all current-policy confirmations. |
| Settings | Safety stop / resume | Owner/admin only; blocks approvals and handoffs without hiding investigation data. |
| Settings | Provider save | Owner/admin only; HTTPS link only, assisted mode fixed, credentials rejected by design. |
| Settings | Export | Authenticated full workspace JSON; intentionally sensitive. |
| Settings | Support data | Authenticated redacted diagnostic JSON. |
| Settings | Add member | Owner/admin only; scrypt password and constrained role. |

Accessibility controls include semantic headings, labels, table headers, focus-visible states, keyboard-operable buttons/links, dialog roles, status announcements, reduced-motion handling, and responsive navigation. Browser evidence at 1440x1000 and 390x844 is recorded in `FINAL_VERIFICATION_REPORT.md`.
