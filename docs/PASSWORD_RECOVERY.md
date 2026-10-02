# Personal local-password change and recovery

This is the password for your **local Simbi Reach-Out workspace**, not your Simbi account. Changing it never logs in to Simbi or changes a provider credential. The existing backend checks the current password, updates its local password hash, removes all sessions for that user and records `account.password_changed` in one transaction.

## What to do

Open **Settings → Account password**. Enter your current local password and a new one of 12–200 characters. The current-password field accepts at most 200 characters. While the request is pending, both password fields and the submit button are disabled. Wait for its result; repeated submission is synchronously refused, including events before the next display update.

| Result | Meaning and next action |
|---|---|
| **Password changed** and the all-sessions notice | Both required confirmation fields are exactly `true`. The fields are cleared and the password form is removed. Choose **Sign in again**, then sign in with the new local password. |
| **The current password is incorrect** | The inspected backend returned HTTP403/`current_password_invalid` before any password write. Your entered values remain; correct the current password and deliberately submit again. |
| HTTP422/`validation_failed` | The inspected request-validation handler refused the request before the endpoint ran. Correct the input and deliberately submit again. Native required/length checks can prevent a request even earlier. |
| **Password change is not confirmed** | A response was lost, unreadable, incomplete or contradictory, or another failure did not establish non-application. The change may already have committed and signed out your sessions. Do not repeat it here. Choose **Sign in again** and check the new password first; if it is rejected, try the previous password. |

For an uncertain outcome, the original password fields stay mounted with their values while this Settings page remains mounted, but they and the change button stay disabled. The dedicated warning and **Sign in again** link remain beside the password form. This does not claim that the password definitely changed or that sessions definitely survived. A500 response merely carrying a pre-write error code is still uncertain; its code alone cannot prove rollback.

**Leaving this page clears these fields and the page-local guard.** Sign in again is an ordinary same-installation link that reloads the account screen. The tool does not automatically try either password, repeat the password change or create another workspace. If neither password works, stop and use the existing [local-account recovery guidance](../README.md#forgotten-local-owner-password); do not replace your database or rerun setup to recover an existing workspace.

## Privacy and boundaries

The app does not add these field values to localStorage, sessionStorage, exports, audit events or a new durable browser copy. Password input is retained only in the mounted form's memory; normal browser/password-manager behavior is outside this app's promise. The existing backend retains a password hash, not plaintext. Authenticated requests still use the existing session and CSRF protections.

This is not a universal Settings lock, cross-tab password-change lock, idempotency receipt, automatic rollback, server-side password-recovery feature or crash-proof secret store. Refreshing ordinary Settings cannot verify a password change or clear its uncertainty latch. Navigating/reloading loses the latch; a later deliberate password change is a new request, not a replay. Other Settings actions retain their separate [safety contracts](SAFETY_MUTATIONS.md). Real owner credentials and the authenticated manual-provider workflow remain separate acceptance gates.

## Developer contract

- `frontend/src/api.ts` checks `POST /auth/password`, including a query suffix, after reading the complete response. Only an object with `changed === true` and `reauthenticate === true` is accepted. Additive response fields remain allowed. It retains the actual HTTP status in `ApiError.status`; payload content cannot invent that status.
- `frontend/src/pages/Settings.tsx` uses the existing `usePendingMutation` synchronous in-flight ref and `PendingForm` fieldset/pending notice. A separate synchronous ref latches verified completion or uncertainty before another queued submit can run. Only the inspected403/current-password and422/request-validation pairs leave the form correctable. The backend and session-revocation transaction are unchanged.
- `frontend/src/password-change.test.tsx` exercises the actual Settings caller and shared client, not a substitute component API. Nine cases cover four false confirmations, two synchronous submits/disabled pending fields, uncertain-repeat refusal/original elements and values, correctable403 and two500/error-code contradictions. The older `/me` refusal test now checks the added actual401 status without weakening its existing equality assertion.
- `scripts/e2e-password-change.mjs` owns fresh isolated fictional servers/databases. English1440×1000 and Dutch390×844 use sequential keyboard controls, not clicks, injected focus or fabricated successful writes. Real local commits precede contradictory200 and actually aborted responses. It checks native invalid input/no write, held real403/pending repeat refusal, original field identity/values, blocked uncertain repeat, deliberate same-owner sign-in, previous-password rejection, independent-session revocation, verified success, eight unchanged record arrays and every earlier audit row.
- Each locale requires four UI password requests (one refused, three committed), four UI login requests, exactly three password-change audits and seven selected accessibility scans. Fixture setup, seeding and independent-session preparation are separate API operations, not user-interface proof. The helper blocks external page requests, never reads owner data and does not log fixture passwords or tokens.

## Reproduce and interpret evidence

After dependency installation and a successful frontend build:

```powershell
$env:SIMBI_E2E_BROWSER = 'chromium'
$env:SIMBI_PASSWORD_E2E_PORT = '4181'
node scripts/e2e-password-change.mjs
if ($LASTEXITCODE -ne 0) { throw 'Password recovery acceptance failed.' }
```

Choose an unused unprivileged port; never stop someone else's listener. Restore your environment choices afterward or use a separate terminal. The full frontend browser entry runs this helper after bilingual bootstrap and before the existing main workflow; every older password happy-path and retained workflow stays in place. The [browser guide](BROWSER_COMPATIBILITY.md) distinguishes isolated helpers, full-entry acceptance and the unresolved default Windows WebKit ordinary-link issue. Screenshots use masked fictional passwords and stay outside the checkout under `../browser-qa/<engine>/`.

Passing these selected checks does not certify every device, assistive technology, owner installation, backup/private-copy lifecycle or authenticated Simbi operation. Exact local and publication evidence, failed attempts and pending gates belong in the [acceptance ledger](PRODUCTION_READINESS.md#personal-local-password-confirmation-preparation-2026-10-02); the original complete personal-production objective remains partial.
