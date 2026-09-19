# MSTY replacement candidate — 0.10.0 / r34

## r35 follow-up

- Home goal links now open the selected goal's details directly.
- Currency changes preserve expanded goal/history sections and scroll position; settings drafts are not rerendered by the currency control.
- Goal date estimates use the first day of the target month to avoid end-of-month overflow.
- Chart amount labels increased to 12px and dates to 11px.
- Modal background controls are inert while the sheet is open.
- ZIP preparation now produces an explicit download link and record counts, rather than claiming that the device saved the file. Preparation is guarded against duplicate requests.
- Live isolated UI verified: home 500-share goal opens; switching USD to KRW keeps detail open and changes required purchase cost from $3,750 to 5,137,500 KRW.
- All seven automated suites and JavaScript syntax checks passed. Pages deployment run 35452155456 succeeded.
- ZIP preparation completed in both iframe and standalone app. Download-event capture timed out once in each mode, so end-to-end file receipt remains unverified; no further identical retries were made.

Reviewed 2026-09-19. This is an evidence log, not a claim that every device or live account has passed.

## Scope and isolation

- GitHub Pages root and `/v4/` contain the candidate. Original V3 storage is not deleted.
- Browser interaction tests used `qa-review.html` → `v4/index.html?demo=1`, a separate QA database with synthetic records. No Toss request or order was submitted.
- Production was checked read-only through its cloud-login entry screen. Google sign-in and actual user-ledger reconciliation are not certified.

## Design references actually inspected

- Asset OS source (`ui-settings.js`, `ui-sheets.js`): grouped settings, sheet scroll locking and dirty-form protection. These informed the new settings and input interactions.
- [Snowball Analytics](https://snowball-analytics.com/): separation of received/planned income and calendar-oriented presentation.
- [Stock Events](https://stockevents.app/en): public product presentation and calendar-first hierarchy; not a paid-account walkthrough.
- [The Rich](https://www.therich.io/): public Korean homepage/navigation only; internal portfolio screen could not be inspected.
- [Tawcan's personal dividend spreadsheet](https://tawcan.com/step-step-guide-make-google-spreadsheet-dividend-portfolio-template/comment-page-1/): shares, per-share income, frequency, reinvestment and actual-income tracking. Its spreadsheet was not imported into this app.
- Searches for additional Korean personal spreadsheets did not yield usable sources. No claim is made that all domestic/foreign apps or spreadsheets were reviewed.

## Implemented

- Home retains the six agreed sections; actual and estimated income are distinct. Zero missing-estimate notices are omitted.
- Home per-symbol dividend detail expands in place. Portfolio no longer repeats the goal card.
- Portfolio places valuation above shares/cost, keeps performance and chart visible, and collapses only transaction history. History initially renders 10 records.
- Goal cards begin collapsed. 250 → 500 → 750 → 1000 advances from holdings. Completed goals show one monthly-cashflow estimate, not a duplicate comparison.
- Grouped exclusive settings, explicit saves, larger touch controls, labeled inputs, dirty-modal close confirmation and background scroll lock.
- Local ledger no longer waits for remote Firebase SDK imports before booting. Save failures are surfaced; brief local-saving flashes were removed.
- Income calculation is isolated in `modules/income.js`: frequency factors, current ownership, split-adjusted per-share amounts, month-end dates, stale/insufficient data handling.
- Restore validates ledger/oversells and shows a replacement confirmation, with a local safety copy before replacing V4 state. ZIP CRC is checked.

## Automated evidence

`npm test`: all seven suites pass (domain, Toss adapter, home metrics, views, ten-year stress, static contracts, replacement cases).

- Ten-year stress: 360 trades and 624 dividends.
- Replacement cases: ownership changes, no projections after full sale, reverse-split invariance, quarterly factors, Jan-31 month-end handling, milestones, nonmutation and ZIP round-trip/corruption rejection.
- `git diff --check`: clean.

## Live browser evidence

- 360px and 412px iframe review; dark and light layouts inspected. At 360px main clientWidth and scrollWidth both measured 345px (browser scrollbar consumes the remainder).
- r33 revealed clipped last weekly column and boot status clutter; r34 was deployed and rechecked. All six weekly columns and the highest amount were visible at 360px. Bars open a full-amount dialog.
- KRW/USD switching changed values and pressed state. No repeated synchronization toast was triggered by navigation.
- Synthetic MSTY 238 + 12 shares produced 250 shares and the 500-share goal. A further 750 shares produced completed 1000-share state; post-goal choice controls were checked.
- SCHD quarterly income rendered $30 per quarter as $10 monthly. JEPI added as a third project; dividend recorded.
- Dirty project form close showed continue/discard confirmation; continue preserved the input.
- History expanded from 10 to 20 records; a dividend was edited. Reload retained three projects, 1000 MSTY shares and the edited dividend total.
- Theme and exchange-rate save were exercised; settings categories remain separate.
- Home symbol breakdown remained on home.
- ZIP creation showed completion without an application console error, but the browser download-event bridge timed out; downloaded-file recovery is NOT certified.
- A controlled ZIP fixture was uploaded through the real file chooser. Preview reported one project/trade/dividend. Confirming restored 250 shares and a 500-share next goal. A plain JSON file was correctly rejected by the ZIP-only importer.
- Production cloud entry displayed Google login and local-use options. Console errors observed were browser-extension metadata errors, not app-origin errors.

## Replacement gate / honest rating

Do not label this a 9/10 complete replacement yet. A numeric self-rating cannot substitute for:

1. Comparing the user's actual MSTY export: shares, cost basis, dividends, reinvestment, available cash and goal/recovery state.
2. User-authenticated Google save/restore and conflict behavior on the intended phone.
3. Confirming backup-file download on that phone. The ZIP encoder/importer and real chooser restore were tested separately.

Toss credentials, real API connectivity, live exchange rates and orders are deliberately outside this release's verified scope. Predictions are estimates from recorded payments, not confirmed issuer schedules.
