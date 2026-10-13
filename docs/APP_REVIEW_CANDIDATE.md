# DividendOS app review candidate

Baseline: main `2979a6625f43519e4608781158bd8f0a318c83fc` (operational release 1.4).

This is a predeployment UI candidate. No main merge, Pages publication, release
ZIP replacement, hot-update manifest change, or Android installation was made.

The candidate gives the detail page four tabs: summary, dividends, recovery (or
management for other categories), and records. Valuation belongs to summary;
the other tabs no longer repeat it. Records are shown immediately rather than
behind a second accordion. A record-add menu uses the existing transaction,
dividend, withdrawal and corporate-action forms. The correction tools remain.

Home adds stock rows and the latest received dividend, retaining monthly/yearly
cashflow, long-history ranges, annual personal alerts and the next goal. Stock
links select the appropriate portfolio category. Goal achievement dates come
from the existing engine's milestone history. Project colors, currency, theme,
cloud connection controls and destination-selectable backups remain available.

Presentation uses solid surfaces, a pale income highlight, restrained project
colors, underlined detail tabs, consistent list rows and the local Pretendard
font. Header geometry remains stable across save/sync status changes.

No financial engine, storage schema, authentication, cloud policy or release
evidence validator was changed. An explicit total-return row uses the same
existing economic total return, separately from ROC accounting adjustments.

## Compact-screen refinement

Home's annual totals and detailed analysis are collapsed by default; early and
reached dividend alerts remain visible. The detail screen uses one stock header
while preserving global currency and settings controls. Records put the period,
type and optional search in one compact filter; period/type changes immediately
refresh results. Recovery and ROC explanations are expandable, with financial
values and critical flags still visible.

## Checks for the current refinement

- TypeScript compilation/typecheck and reproducible 40-file static build pass.
- QA RELEASE profile: all 30 Node test suites pass.
- Browser assertions cover collapsed annual details, the single detail header,
  immediate record filtering, search/reset and preservation of financial records.
- Local Chromium download failed with a malformed archive. Mobile, desktop and standalone-file browser checks passed in draft PR CI instead.
- The prior review completed 36 focused browser checks after the nav-clearance
  fix; those historical results are not current-refinement verification.
- CI run `38341721588` verified runtime commit `8fd4e750589191452455f324bea9ae0990191757`: 170 browser tests passed; 12 opt-in long-entry tests skipped. The mobile and desktop standalone-file checks both passed. FAST, CORE, Android build and Android backup jobs also passed.
- Reviewed mobile home, summary, dividend, recovery and record screenshots from artifact `11786809118`.
- Physical Galaxy/actual Toss authentication evidence is outside this web review.

## Standalone review copy

`v4/scripts/build-review-preview.mjs` packages the same compiled UI and engine
into one HTML file. The normal candidate stays multi-file and fully functional.
Only the generated review copy uses synthetic demo data, a dedicated review
store, no cloud SDK connection, and a data-only ZIP rather than an app-directory
backup. It seeds once, so local review edits survive reload. It embeds the local
font and bundle and requires no network dependency for startup or local input.

Runtime release/version identifiers stay at 1.4 until a separate release cut;
the review copy is visibly marked as unpublished. Synthetic examples must not
be treated as the user's production holdings or restored into production.

Standalone review SHA256: `7b6ecf2da3a70e0b38c57d4fd0f02831b36849c253f3a339968b969ae9b0dd5c`.
