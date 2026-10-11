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
Local release QA passed all 30 suites, including typecheck, security and reproducible static build, after producing the signed 1.4 web bundle. SHA256: fac135a805f36c84a57e1122b39e296b6332415e7a52b4fb0118982674ef3a10.

The initial browser run with hard and lifetime checks was interrupted. Its log ends at test 23/178 and the lifetime fixture ends at 120/720 saved records; it is NOT counted as a completed pass. Final ordinary browser run completed: 166 passed, 12 opt-in tests skipped (6.3 minutes). Mobile height failures from the preceding run were fixed by placing the records action beside income; the unchanged height requirement and 20 targeted checks passed. Final release QA again passed 30 suites. ZIP hash, RSA signature against the Android public key, and bundled final views/CSS were independently verified. Opt-in lifetime, high-lifetime and switching checks must not be claimed from skipped tests.

## Q3 remains blocked
Run 38142236835 release evidence describes commit 135a85effc2765c7faf784b8f4ee577b85382925, appVersion 0.12.7 and completedAt 2026-09-28T08:01:12.640Z, rather than the exact 1.3 candidate. It also exceeds the 7-day freshness limit. Its passing fields cannot be reused or relabeled for 1.4.

Downloaded Android backup evidence contains seven passing Android 16 emulator tests; it is not physical Galaxy S25 Ultra evidence. The browser artifact name does not establish completion of the opt-in lifetime tests.

Production merge and deployment require valid evidence for the exact final candidate: physical Galaxy flows, Toss read-only, backup/restore hashes, rollback and PWA data preservation, and zero QA artifacts. No validator or workflow gate has been weakened.
