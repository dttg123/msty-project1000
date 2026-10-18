# DividendOS 1.15

Late FX, Toss and background cloud responses now wait until an active local form save has completed or rolled back. Cloud conflict backups also wait for a committed ledger. Toss snapshot application uses the same rollback boundary as manual changes, preserving original project prices and source rows when local persistence fails. Receipt cash-time confirmation uses the guarded submission path, including immediate retry and rollback.

Whole-ledger checks now accept valid KRW and explicit net-zero receipts. Duplicate candidates compare exact canonical net cash and currency rather than rounded legacy amounts. CSV export copy reflects all five exported files, including cash adjustments.

The mandatory UI suite adds 38 mobile/desktop cases: delayed responses, failed-save leakage, interrupted saves and restart, duplicate submission, canonical duplicate checks, mixed-currency/state reporting, quoted CSV notes, and actual downloaded ZIP restoration at 360px and 800px with enlarged text. Historical archived income remains included consistently in home and month detail; no archive calculation change is made.

All reproduction and validation use isolated synthetic data. No production user ledger is rewritten. Native backup code and saved schema versions are unchanged. Physical Galaxy and real-account acceptance remain explicitly pending after update. See [cross-boundary investigation](QA_CROSS_BOUNDARY_2026-10-18.md).

Candidate [39134977585](https://github.com/dttg123/msty-project1000/actions/runs/39134977585) passed on `e447f54efd45ba6437034ea494c15b1573a5eb80`: 308 UI passed, 12 opt-in skipped; 31 release suites; 8 Android backup checks; permanent APK signature and signed publication verification. Six additional selected long UI scenarios were exercised locally. The first run recorded five passes and one desktop 15-minute timeout after 720 saves; the original failure is retained. The identical desktop test assertions and 15-minute limit passed in 8.1 minutes on a standalone retry with trace/video off and reduced-motion preference. This does not retroactively mark the original recorded run passed or claim physical-device acceptance.
