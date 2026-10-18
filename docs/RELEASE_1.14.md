# DividendOS 1.14

Existing dividend edits now read the canonical net receipt instead of a conflicting legacy amount. Saving a memo or date preserves the original gross, tax, fees, net and ROC information. Individual receipt displays, per-share values and amount search agree with summary totals. Explicit net-zero and fractional existing receipts remain editable without losing their values.

Dividend submission now releases its duplicate-submit guard when saving actually completes, allowing immediate retry after a failed save. Explicit ROC percentage changes replace an older absolute ROC override; metadata-only edits preserve it. Explicit currency changes clear stale fields in the other currency. Existing persistence rollback, future-date and dividend-funding deficit guards remain active.

[Root cause, missed QA boundary and broader audit](INCIDENT_DIVIDEND_NET_EDIT_2026-10-18.md). Twenty-two new mobile/desktop cases cover the affected boundaries; publication fingerprints and automated results are recorded in `releases/1.14.0.publication.json`. No production native backup code or saved schema version changes. Already overwritten historical amounts are not guessed or repaired by publication. Physical device and real account acceptance remain pending after update.

Candidate CI [39108059315](https://github.com/dttg123/msty-project1000/actions/runs/39108059315) passed on `2d682c0edca4b8defbc86f3f56f583a72a3a4760`: 270 mobile/desktop UI cases passed, 12 unchanged opt-in cases skipped; Android 16 backup 8/8; permanent APK certificate verified; release and signed publication gates passed. This evidence-only descendant retains identical runtime and update artifacts.
