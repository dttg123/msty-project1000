# DividendOS reliability review — 2026-10-18

Base: main `2b8bf4497c4dedb9ab847007fb6bac240c16d1db` (1.11).
Fix: `a03590d55d566a6606834576a6671901d843fce0`, PR #51.
Scope: finance correctness, interruption/concurrency, upgrade/recovery,
clarity/accessibility, long-term usage, and honest failure states.

## Confirmed findings and changes

1. A receipt with `amountUSD: 99` and `netAmountUSD: 8.5` produced a cumulative
   project total of 8.5 but month/year/overall totals of 99. Summary calculations
   now use `dividendCashBreakdown().netUSD`. Display projections copy USD rows
   with the canonical net amount, so graphs/composition/recent-receipt amounts
   also follow that rule. Saved source fields remain unchanged. KRW receipts
   remain KRW in storage and are converted only for display.
2. The recent-12-month card included the anniversary date while detailed
   analytics excluded it, and the card constructed its boundary from the UTC
   date. Both now use the same interval `(local date minus one year, local date]`.
   This fixes disagreement around midnight in Korea as well as the inclusive
   boundary discrepancy.

Regression tests cover explicit net and explicit zero, mixed currencies,
future/estimated exclusions, source immutability, and the local midnight boundary.
Finance checks pass under both UTC and Asia/Seoul.

## Verification

- Final `npm run qa:release`: 31 suites passed, including types, security and
  reproducible production build. Financial golden fixtures were not changed.
- Synthetic 30-year individual ledger: 2,166 trades and 6,000 dividends;
  high-value 8/9-symbol scenarios also passed.
- Synthetic 35-year storage: 16,380 dividends and 3,780 trades; compressed
  backup checks restored seven copies with exact checksums. Cloud adapter tests
  cover failed staging/publish, conflicts and content verification.
- Targeted mobile/desktop Chromium: 48 passed. Includes real IndexedDB
  migration, write/backup abort, stale tabs, legacy edits, deletion/reordering,
  fallback and memory-only warnings, mutation retry/double-submit, offline
  reconnect, cloud conflict and update failure status.
- Remaining ordinary UI regression: 188 passed, 14 explicitly skipped opt-in
  or standalone-preview cases; combined browser result: 236 passed, 14 skipped,
  zero failures. The separate multi-hour UI scenarios were not enabled.
- GitHub CI on the financial fix: FAST, CORE and Android build passed.
  Android backup instrumentation failed 1 of 7 tests at selected-location file
  writing (`pickerRetainsSmallCallAndWritesSelectedLocation`). Run 39083531266,
  job 117545323278. Its captured call discarded the native exception cause.
  Commit 0572348 preserves that cause in diagnostics. Its follow-up emulator
  run 39083912126, job 117546451666 passed all seven tests. This is a flaky
  first-fail/retry-pass result, not a demonstrated fix. The original exception
  cannot be recovered from the first log; the underlying cause remains
  unresolved and blocks publication. Further blind reruns were not used.

The normal Playwright browser download returned truncated ZIP data. Local
browser tests instead use Chromium 153.0.8010.0 from an already available
serverless Chromium package; temporary runner configuration selects its binary.
Application behavior and test assertions were not weakened. Browser/emulator
results are not physical-device acceptance.

## Large-area assessment and limits

- Finance: fixed the two independently reproduced discrepancies above; golden
  calculations, currency handling and long-term ledger checks pass.
- Interruption/concurrency: tested abort/retry and stale-writer rejection with
  isolated ledgers; no new defect reproduced in these scenarios.
- Upgrade/recovery: migration and backup reconstruction pass; the signed updater
  contract and update-state checks pass. GitHub CI built the native APK and ran emulator instrumentation; the
  selected-location failure remains unresolved despite a successful diagnostic
  retry. No physical APK
  installation was performed.
- Usability: ordinary mobile/desktop regressions inspect narrow screens, text
  scaling, focus/navigation and save/error wording. These are targeted checks,
  not a claim of complete WCAG conformance.
- Long-term operation: ledger/storage scenarios use 30–35 years of synthetic
  data. They do not establish real Galaxy memory, battery or latency limits.
- Diagnostics: failed storage/cloud/update states are tested for honest status;
  this review does not introduce a remote telemetry service.

All application test ledgers are synthetic and isolated browser contexts or
in-memory adapters. No customer account, live Toss request or production
Firestore write was used. Physical Galaxy/Toss acceptance and multi-hour
35-year interactive UI scenarios were not executed in this review.

No production update ZIP, manifest or publication evidence is replaced here.
The reviewed changes are proposed in PR #51. Reverting that PR's code changes
restores the prior behavior; no storage schema or saved receipts are migrated.

## Reference approach

- Google SRE data integrity: https://sre.google/sre-book/data-integrity/
- Google SRE monitoring: https://sre.google/workbook/monitoring/
- Android core quality: https://developer.android.com/docs/quality-guidelines/core-app-quality
- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
