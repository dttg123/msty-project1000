# DividendOS 1.4 candidate QA

Base: main cd2542470e711fdcfa8242a501c369e8a3c35d4e (PR #40, version 1.3).

## Changes
- Detail explanations use the 13px scale and chart labels use 12px. Dense charts scroll horizontally.
- Primary valuation, profit/loss, holdings and selected dividend amounts fit their available width without splitting digits; return percentage is separate. Profit/loss spans inherit their signed color.
- Summary average purchase price uses purchase basis before ROC; ROC-adjusted cost and unrealized profit are shown separately in detail.
- Price-only unrealized profit and purchase-basis realized profit are named consistently; accounting engine is unchanged.
- Compact mobile header and shorter status labels reduce vertical space.
- Six-month dividend chart shows year boundaries. Selecting a month updates the amount above the chart; a separate button opens its records. Selection does not write ledger data.
- Connection details remain in settings; dividend use and yield labels explain their meaning.

## Validation and limits
Recovery on 2026-10-12 found seven final local files missing from PR head b80ef085, including the ZIP. The earlier browser launch log had no completion summary; its reported final pass is not counted as recovered evidence. The cause of that interruption is not established by the available logs.

Fresh local release QA passed all 30 suites, including typecheck, security, 30-year individual ledger entries, 8/9-stock high-value ledgers, hardening and reproducible static build. Final ZIP SHA256: b7f822d28045a663a1ca354922d3d07a698ddb48403c1f09b3ada9676c2d3078. ZIP CRC, every manifest file hash, byte equality against final runtime source, and RSA signature against the committed Android public key passed. All seven uploaded Git blob hashes match their local file bytes.

The observable ordinary browser rerun completed with exit code 0: 166 passed, 12 opt-in skipped, 0 unexpected failures, 0 flaky results, 0 runner errors (10.3 minutes). Its checkpoint finished at 2026-10-11T23:57:43.692Z. Summary: QA_1.4_BROWSER_RESULT.json. Opt-in lifetime, high-lifetime and switching checks must not be claimed from skipped tests. Recovery commands and interruption handling are documented in QA_RESUME.md.

## Q3 remains blocked
Run 38142236835 release evidence describes commit 135a85effc2765c7faf784b8f4ee577b85382925, appVersion 0.12.7 and completedAt 2026-09-28T08:01:12.640Z, rather than the exact 1.3 candidate. It also exceeds the 7-day freshness limit. Its passing fields cannot be reused or relabeled for 1.4.

Downloaded Android backup evidence contains seven passing Android 16 emulator tests; it is not physical Galaxy S25 Ultra evidence. The browser artifact name does not establish completion of the opt-in lifetime tests.

Production merge and deployment require valid evidence for the exact final candidate: physical Galaxy flows, Toss read-only, backup/restore hashes, rollback and PWA data preservation, and zero QA artifacts. No validator or workflow gate has been weakened.

## Deployment preflight on 2026-10-12
Latest PR CI run 38215290132 failed the mobile and desktop theme-save cases (164 passed, 2 failed, 12 opt-in skipped). The trace shows fixture projectStart 2026-10-12 while the browser clock is pinned to 2026-10-11. The application's existing future-date guard correctly rejected the save. The test now uses the pinned browser's local day for all project starts and explicitly asserts the edited date. No application date guard, test expectation, timeout or deployment gate is weakened. A fresh CI result is required for this test fix.

Local browser installation is unavailable in the renewed environment: Playwright's browser CDN download returned an invalid ZIP. These local launch errors are environment failures, not completed application tests. Use the GitHub runner for the browser validation. Production remains blocked on the separately documented current-candidate Q3 evidence.
