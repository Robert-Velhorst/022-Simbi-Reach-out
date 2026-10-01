# Browser compatibility and reproducible acceptance

This is a personal, single-owner tool. Browser checks use fresh fictional local workspaces, never Robert's database or Simbi account. The frontend-testing guidance requires rendered interaction and screenshot evidence, not just a successful build.

## Scope of the checks

`scripts/e2e.mjs` and `scripts/e2e-retirement.mjs` select the exact Playwright engine through `SIMBI_E2E_BROWSER`: `chromium` (default), `firefox`, or `webkit`. Unknown/empty names fail instead of silently testing another engine. No installed browser profile or signed-in provider session is used. Console/page errors and unexpected external HTTP requests fail the tests; provider navigation and delivery are not attempted.

All engines run the same existing assertions in English and Dutch: setup/sign-in, owner/viewer restrictions, campaign/contact/template creation, exact-content approval, cancelled/interrupted handoff recovery, local fictional sent/reply/reminder/report records, password reauthentication, loading states on Overview, Prospects, Campaigns, Templates, Review queue, Replies, Reminders, Reports and Audit log, bilingual persistence and cross-tab unsaved input preservation, and contact/campaign/template cleanup. Campaign read/retry and stale report refresh are separately checked. Separate sole-owner fixtures exercise retirement, backup receipts, cancelled confirmation with cleared secrets, sibling-tab private-view removal, reload with blocked setup/login, and recovery after a real successful confirmation whose response is interrupted.

Desktop 1440x1000 covers the primary operational journey; mobile 390x844 covers navigation, report-table scrolling, loading states and read-only handoff presentation. Short-mobile 390x450 covers handoff and privacy/retirement confirmation bounds, focus and scrolling. Selected automated WCAG scans cover the dashboard and privacy/retirement surfaces in both locales; they are not a full route or screen-reader audit. The scripts explicitly count the two data HTTP503, one session HTTP503 and one signed-out HTTP401 responses, independently of engine-specific console formatting. These are deliberate failure probes, not unexplained errors.

Historical audit minimization also runs through the full main harness in both locales. It seeds only the harness's fresh fictional database, previews exact old event/field identifiers without showing original text, cancels with cleared password/checks and restored focus, checks desktop/short-mobile dialogs and selected WCAG rules, confirms an actual backed-up update, substitutes a wrong-plan response to require truthful uncertainty, and retries for the existing receipt. It verifies core event/recognized approval evidence, operational restrictions/settings, original backup contents, one completion event and receipt recovery after reload. This is not an authenticated provider test or full historical anonymization. Named screenshots include `simbi-audit-privacy-en-desktop.png` and `simbi-audit-privacy-nl-mobile.png` in the same engine-specific external folder.

Each test child must successfully bind its own loopback port before readiness is accepted. If another listener owns that port, the suite stops before fixture requests. This applies to the main and retirement harnesses. Fresh `.e2e-runtime/run-<engine>-*` and `retirement-<engine>-<locale>-*` folders preserve earlier runs. These folders contain private fictional fixture data and credentials; do not use them for real records or upload them as support evidence. Screenshots with explicit names are separated by engine outside the checkout under `../browser-qa/<engine>/`, relative to the repository root (not this docs folder). Examples include `simbi-qa-report-mobile.png`, `simbi-retirement-nl-mobile.png` and `simbi-retired-nl.png`; overview `desktop.png`/`mobile.png`, locale and failure screenshots also remain in their corresponding ignored fixture folder. Each successful harness prints its engine/version, fixture folder, screenshot directory and actual checked outcomes.

## Run the full suite

Run from the repository root in PowerShell, after the [README dependency installation](../README.md). The backend must be installed into `.venv` (the Windows harness defaults to `.venv/Scripts/python.exe`); the frontend must be installed from its frozen lockfile. The exact Playwright version is pinned in `frontend/package.json` and `frontend/pnpm-lock.yaml`. `test:e2e:run` runs selector contracts, then the complete main harness, then both retirement locales; a failing earlier command prevents later commands from running. Build and install matching browser runtimes before invoking it:

```powershell
pnpm.cmd --dir frontend build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
pnpm.cmd --dir frontend exec playwright install chromium firefox webkit
if ($LASTEXITCODE -ne 0) { throw 'Browser runtime installation failed.' }
$PreviousTestBrowser = $env:SIMBI_E2E_BROWSER
try {
    foreach ($TestBrowser in @('chromium', 'firefox', 'webkit')) {
        $env:SIMBI_E2E_BROWSER = $TestBrowser
        pnpm.cmd --dir frontend test:e2e:run
        if ($LASTEXITCODE -ne 0) { throw "Acceptance failed for $TestBrowser." }
    }
} finally {
    $env:SIMBI_E2E_BROWSER = $PreviousTestBrowser
}
```

The main suite defaults to 4173 and retirement to 4178. Choose unused unprivileged ports through `SIMBI_E2E_PORT` and `SIMBI_RETIREMENT_E2E_PORT` if needed. For example, set these variables and run the full-suite block above in that same separate temporary PowerShell window:

```powershell
$env:SIMBI_E2E_PORT = '4185'
$env:SIMBI_RETIREMENT_E2E_PORT = '4186'
```

Close that window afterward so its port choices do not leak into ordinary checks. Run sequentially as above; simultaneous suites must use distinct pairs of ports. These browser harnesses create distinct fresh folders; backend pytest uses a separate shared `backend/tests/.runtime` fixture directory and should not run concurrently with another backend pytest suite. No test server should be stopped merely to free a port belonging to someone else.

Linux CI keeps Chromium in the existing full verification job and runs the complete browser suite in independent Firefox/WebKit matrix jobs, with the exact runtime installed using `--with-deps`. The Windows standalone build/smoke remains a separate job. A passing engine selector unit test is not rendered-browser proof. Consult the exact commit's CI jobs and [dated acceptance ledger](PRODUCTION_READINESS.md#cross-browser-personal-workflow-acceptance-2026-10-01), not an older badge.

With GitHub CLI access, find commit-specific runs from the checkout using `gh run list --commit <full-commit-sha>`, then inspect the chosen run using `gh run view <run-id>`. Require successful `verify`, both `browser-compatibility` jobs and `windows-standalone`; do not treat a partially finished matrix as a successful release. The ledger links exact runs once publication is verified.

## Evidence and remaining limits

The ledger records engine versions, actual runs, checks and any failed attempts. The initial Windows Firefox run exposed a harness startup wait issue: `networkidle` was observed before document load and setup subsequently timed out. Waiting for `load` on initial navigation, while retaining explicit heading/state assertions, allowed the full workflow to run. No application timeout was increased and no setup or safety assertion was removed. This is a test-harness repair, not a proven Firefox application defect.

Playwright WebKit is not installed Safari, and a resized desktop viewport is not a physical phone. Official [Playwright browser documentation](https://playwright.dev/docs/browsers#webkit) distinguishes its patched engines from branded browsers. These results do not establish current branded Edge/Chrome/Safari, iOS/Android virtual keyboards, dedicated assistive technology, every browser setting/extension, a fresh Windows installation, authenticated Simbi use or delivery. The personal production objective and phase050 therefore remain partial; other open gates stay in the [completion matrix](GOAL_COMPLETION_MATRIX.md).
