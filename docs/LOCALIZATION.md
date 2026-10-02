# English/Dutch interface localization

## For the personal operator

Choose English or Nederlands before setup/sign-in or in the application header. The default is English; the browser remembers the selection. This does not change your Simbi account, stored records or message language. To write in Dutch, author a Dutch template or edit the draft, save it and repeat the normal review. The starter template remains English deliberately rather than changing an unsaved message when the interface changes.

Nederlands: kies **Nederlands** in de taalkeuze. Alleen de bediening verandert; namen, notities, sjablonen en berichten blijven zoals je ze hebt ingevoerd. Je moet elk bericht zelf beoordelen en eventueel zelf op Simbi versturen. De app verstuurt niets. De Engelse voorbeeldtekst kun je zelf vervangen door een Nederlands sjabloon.

The selector is outside native dialogs and correctly becomes inert while a dialog is open. Close the dialog before using the header selector; a real language change in another tab updates the open dialog without losing its inputs. Language is browser-local, not synced across devices/users. Denied storage permits current-tab changes only. Clearing the preference returns to English. Dates are formatted in the browser's time zone, not changed in the database.

## Developer contract

Current catalogs contain 717 matching keys: six core-recovery additions cover the per-action opaque reference notice, three refusals, invalid-key explanation and retirement-table label. The previous 711-key reminder snapshot added five keys covering the opaque retry notice/reference, three known refusals and the retirement receipt-table label. The preceding 706-key snapshot added the escaped original-value unrecognized-date label to the 705-key pending-form snapshot. That earlier wait/check-before-retry notice extended the 704-key complete-response snapshot. Four earlier complete-response/cancellation/uncertainty messages extended the 700-key draft-leave snapshot; five draft-leave labels extended 695 keyboard-bootstrap keys. The earlier 691-key comparison/recovery snapshot added 19 to 672 keyboard-navigation keys. These are historical snapshots, not competing current totals. See [request recovery](REQUEST_RECOVERY.md) and [draft saving and leave choices](DRAFT_SAVING.md); authored text/version field names remain unchanged.

`frontend/src/i18n.tsx` provides a React context, typed `t` lookup, UI-message formatting, canonical code-label formatting and dates. `main.tsx` mounts one provider above the app; it must not be keyed by language or remount forms when the locale changes. The default context is English for isolated component tests. No DOM scraping/replacement, HTML parsing, remote translation service or dependency was added.

Stored-date display uses the shared strict parser in `frontend/src/timestamps.ts`, not browser string-date guessing. Recognized instants display in the browser's local time zone at minute precision; unsupported nonempty values show **Unrecognized date: {value}** / **Onherkende datum: {value}** with literal escaped original text, and empty values retain **Not set** / **Niet ingesteld**. No date or historical row is rewritten. Supported grammar, UTC year boundaries and microsecond ordering/confirmation limits are authoritative in [the record/date contract](CRITICAL_PATH.md#conversation-records-and-older-dates). Shared formatter coverage does not certify every date-bearing surface or a default server clock.

The historical keyboard-navigation snapshot of `frontend/src/locales/en.json` and `nl.json` had672 matching keys: two additive keys name the main region and first-tab bypass; navigation/dialog/table labels reuse the existing catalog. Earlier snapshots:670 at retention/reference recovery,657 at historical audit controls,625 at personal retirement,574 at campaign/template cleanup,552 at contact cleanup and501 at the preceding bilingual release. Retention page counts, oversized-history protection, explicit continuation/restart and unverified-preview/receipt recovery are localized. Historical audit previews, field labels, warnings, counts, confirmation, receipts and errors are localized; event/entity codes and IDs remain canonical. Retirement review/warnings/counts/errors and the retired screen are localized without storing/translating owner-authored names. `RETIRE` remains a fixed confirmation literal in both languages. English source keys are stable lookup identifiers; do not generate keys from user content. Use complete sentences with named interpolation for counts/dates/names rather than language-dependent word concatenation. `translate` uses callback replacement: dollar signs, braces and other text in parameter values remain literal and are never interpolated again. React escapes rendered text.

Use the formatter only for known interface/error messages, never names, subjects, notes, bodies, campaign descriptions or other authored data. Known server errors translate by their exact canonical message. Unknown diagnostics retain the original detail with a localized explanation; they are not claimed to have complete Dutch diagnostic coverage. Composite CSV validation errors retain the canonical source detail and translate it at render time, so a subsequent language change works.

Status values, role identifiers, entity/event codes, URLs, CSS classes, API paths, JSON payloads, CSV column names and template fields remain canonical. Known code labels are localized separately for display; unknown future codes remain readable rather than changing stored values. CLI output, exported JSON, linked Markdown documentation, generated worker reminder titles and external provider content are outside the UI catalog. The app does not translate authored messages automatically.

## Glossary and protected syntax

| English | Dutch interface term |
|---|---|
| Prospect | Contact / contactpersoon |
| Template | Sjabloon |
| Draft | Concept |
| Review queue | Beoordelingswachtrij |
| Handoff | Overdracht |
| Assisted mode | Handmatige modus |
| Provider | Platform |
| Suppressed | Contact geblokkeerd |

Keep Simbi Reach-Out, JSON, CSV, SQLite, CSRF and technical identifiers unchanged. Preserve the exact CSV fields `name,source_url,organization,provider,contact_handle,notes,consent_status`, and message-template syntax `{name}`, `{organization}`, `{campaign}`, `{notes}`. Dutch status labels are not permitted as API enum values.

## Maintenance and verification

For every new interface string, add both catalog values, preserving every named interpolation token and the safety meaning. Keep dynamic keys constrained to known navigation/check labels or code-formatting maps; do not pass record text to `t`. Run frontend tests, lint and build, backend tests/Ruff when heuristics change, then the existing Playwright workflow against isolated fixtures.

Tests enforce key parity, nonempty Dutch values, interpolation-token parity, known static `t` keys, absence of untranslated static JSX/label text except explicit brand/language/data-format exceptions, and protected CSV/template syntax. State tests cover default/damaged/denied storage, tab synchronization, unsaved setup/password/modal text, review checks, literal parameters and localized dates/codes. Unit storage is an explicit browser-shaped fixture because Node25's experimental storage shadows jsdom; Chromium separately tests real localStorage persistence and cross-tab events.

`scripts/e2e-locales.mjs` extends the real local workflow: Dutch setup, all operational route headings/help/settings, campaign/contact/template/draft creation, content-preserving approval, cancelled handoff, a separate fictional ambiguous/reply path, reminders/reports/audit, language persistence and a sibling-tab language change while a native dialog is open. It compares actual exported table arrays before/after a language-only switch. No external provider request or real credential is used. Desktop1440x1000, mobile390x844 and short dialog390x450 are exercised. Automated selected WCAG checks are not screen-reader, linguistic or all-browser certification; see the dated readiness ledger.
