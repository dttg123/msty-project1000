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

## Checks

- TypeScript compilation/typecheck and reproducible 40-file static build pass.
- QA RELEASE profile: 30 test suites pass, including the existing 30-year
  calculation, stress, resilience, security and contract checks.
- The focused 13-test mobile UI suite passes after fixing status geometry and
  shortening the overview. Review navigation also verifies that screen changes
  preserve trades, dividends, projects, adjustments and splits.
- The standalone review file boots without HTTP requests, records a dividend,
  preserves it across reload, and exports a ZIP that passes the existing backup
  reader and contains that record.
- Full browser run: 169 passed, 12 opt-in long-entry suites skipped. One
  desktop settings test exposed a save button partly under the fixed nav.
  Scroll padding/margins now reserve the nav area, and the settings test also
  checks that the button is above the nav before clicking. The unchanged
  scroll-preservation assertion passes after this fix.
- Final focused recheck covers 36 mobile/desktop navigation, typography, input,
  settings, and standalone-file cases: all 36 pass after the nav-clearance fix.
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

Final standalone review SHA256: `74050724dbc3e1e9e39752c0be1af971ea394515a359bb9c286e18306025af5d`.
