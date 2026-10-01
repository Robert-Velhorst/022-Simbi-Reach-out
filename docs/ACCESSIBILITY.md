# Keyboard access and accessibility scope

## Using the personal application

On a signed-in page, the first Tab reveals **Skip to main content** (**Ga direct naar de hoofdinhoud** in Dutch). Enter moves focus directly to the named main region without changing the route or records. Selecting a navigation link moves focus to that page's content, including selecting the current route. Page headings identify the destination; loading and error messages remain truthful while records are fetched.

At widths of 980 CSS pixels or less, the desktop sidebar is hidden, not merely moved offscreen. Tab to **Open navigation** (**Navigatie openen**) and press Enter or Space. The named native dialog opens with focus on **Close**. Tab/Shift+Tab cycle through its close control, ten primary routes, Help and Sign out; the underlying page is inert while it is open. Escape, Close or clicking the backdrop dismisses navigation and restores its trigger. Selecting a route closes it and focuses the main region instead. Switching to desktop width closes the drawer and focuses content; an invisible drawer cannot keep the desktop page blocked.

The drawer scrolls in a short viewport. Focusing its last control brings that control into view. **Sign out is an account action**, not a navigation demonstration: activate it only when you intend to end the local session. Help is available inside mobile navigation as well as the desktop header. The language selector is outside the modal; close navigation before changing it, or use another tab's existing language preference workflow.

Populated dashboard queue, prospects, reports and audit tables are named, keyboard-focusable regions with native table headers. Tab to the table region and use Left/Right arrow keys to reveal overflowing columns. The scroll stays inside the table rather than widening the page. Keyboard-focus indicators use a solid blue outline, including navigation/menu/language controls and table regions. Main-region focus is a programmatic reading destination, not an extra sequential Tab stop.

Other forms use the existing native dialogs, labelled controls and notices. Explicit saving/review/confirmation is unchanged: navigation does not autosave, approve or send a message. Save draft edits before leaving a page; do not treat a route change or focus change as proof of a completed write.

## Implementation and reproducible checks

`frontend/src/components/AppShell.tsx` owns one responsive-navigation dialog, stable content/return-focus refs, the bypass link and route focus. Desktop/mobile navigation share the same content component; mobile adds Help because the header link is hidden there. A single media-query listener exists only while the drawer is open and is removed on dismissal/unmount. `components/ui.tsx` supplies the native dialog and named `TableRegion`; the four table consumers preserve native table structure. No new dependency, backend endpoint, permission, migration or browser storage is introduced. Only two English/Dutch catalog keys are added; no authored record is translated.

Unit regressions check first-tab bypass, labelled native-dialog state, cancellation/return focus, new/same route destination focus, breakpoint closure/listener cleanup, table-region/header semantics and prevention of backdrop mousedown's default focus action overwriting restored focus. jsdom's native-dialog shim supplies visibility only; it cannot prove browser top-layer inertness, layout or scrolling.

The existing full main harness now calls `scripts/e2e-navigation.mjs` for both a real fictional owner session and the existing read-only viewer session. Per role/engine it visits all eleven routes in both locales at 1440x1000 and 390x844: **44 route checks plus four open/short-drawer scans**. It checks page identity/content, first Tab and Enter, actual sequential drawer Tab/Shift+Tab/Enter, Space reopening, Escape and backdrop dismissal, focus restoration/destination, menu expanded/control attributes, hidden desktop navigation, Help, short 390x450 scrolling and open-drawer desktop resize. Overflowing populated tables must scroll after a real ArrowRight key. It rejects navigation-related API writes and compares all nine exported owner record tables before/after; the viewer is not granted export permission for these checks. It scans selected automated WCAG 2.0/2.1/2.2 A/AA rules on each tested route and drawer; zero reported violations is required, not a claim that every criterion was tested. Existing guarded local workflow, privacy, backup/recovery and retirement checks are retained, not replaced by this helper.

Run the complete existing suite using the [browser guide](BROWSER_COMPATIBILITY.md#run-the-full-suite). Source paths and helper presence are not execution proof: consult the current dated [acceptance ledger](PRODUCTION_READINESS.md) and exact-commit CI. Named screenshots are outside the checkout in `../browser-qa/<engine>/`: `simbi-navigation-owner-en-skip.png`, `simbi-navigation-owner-nl-mobile.png` and corresponding viewer/locale variants. Fixture databases and temporary credentials must never be uploaded as proof.

The exact route inventory below applies to both owner and viewer; it is a navigation inventory, not permission to perform each page's write actions. English and Dutch labels resolve from the existing catalog.

| English navigation label | Application path |
|---|---|
| Overview | `/` |
| Prospects | `/prospects` |
| Campaigns | `/campaigns` |
| Templates | `/templates` |
| Review queue | `/review` |
| Replies | `/replies` |
| Reminders | `/reminders` |
| Reports | `/reports` |
| Audit log | `/audit` |
| Settings | `/settings` |
| Help | `/help` |

## Remaining limits

This is a bounded keyboard/automated review, **not WCAG conformance certification or screen-reader acceptance**. Owner and viewer navigation are exercised; unit role guards retain admin/editor actions, but this does not prove every action for every optional team role. Every form validation/retry state, keyboard-only full outreach journey, browser extension/zoom/high-contrast setting, assistive-technology combination, branded browser and physical device is not covered. Real provider pages and authenticated sending are outside these checks. No live account or installed personal database is used or modified. Broader acceptance remains separate in phases049/073 and the personal readiness ledger.

The navigation uses the [W3C modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) as guidance for contained, escapable focus and logical return focus, and [W3C bypass-blocks guidance](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html) for the shortcut. Using these patterns is not itself an accessibility certificate. Report a problem with the route, language, viewport, focused control, exact keystrokes and redacted expected/actual behaviour.
