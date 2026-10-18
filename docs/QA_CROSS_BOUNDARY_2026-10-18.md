# 1.15 cross-boundary investigation

The 1.14 runtime ZIP was served separately and new UI tests reproduced the failures before checking the corrected runtime. Existing tests covered save failures followed by later actions but did not cover a *second asynchronous writer completing while the first local mutation was still pending*.

| Confirmed path | Observed in 1.14 | Correction |
| --- | --- | --- |
| Toss receipt time → local save failure → currency save | Failed cashTime later persisted | Include cashTimeForm in guarded state-action rollback |
| Pending cash mutation + late FX/Toss response | Other writer persisted uncommitted cash 12.34 | Apply background results after active form completion/rollback |
| Toss snapshot persistence fails → later setting save | New currentPrice 42 leaked into original ledger | Wrap snapshot application in full state rollback with preserved row references |
| Background cloud acknowledgement + pending local mutation | Cloud metadata write committed the pending local row | Distinguish immediate committed save from background cloud write; wait before background metadata persistence |
| Cloud conflict notification + pending failed mutation | Automatic backup contained uncommitted cash | Process conflict notifications/backup after the mutation settles |
| Whole-ledger health/duplicate checks | Valid KRW/net zero flagged; raw/rounded amount could falsely flag or miss duplicates | Canonical currency/net, explicit zero semantics, exact duplicate key |

Ten failing UI cases reproduced these paths against the unchanged 1.14 runtime: six receipt/FX/health cases, two Toss cases, and two cloud cases. Early harness connection/selector failures are not counted as product reproductions. The initial claim of a home/month archived-income mismatch was incorrect: both included archived historical income. The proposed calculation change was discarded; positive regression tests retain this behavior.

New mandatory cases also cover successful delayed writes, cancellation while saving, repeated submit, interruption before completion followed by reload and ZIP readback, source-field preservation, and downloaded CSV/ZIP fidelity. CSV export includes five files; comma/quote/newline notes are parsed with Python's standard CSV/ZIP readers, then a real backup is restored after an actual cash adjustment. Narrow mobile and tablet-size layouts use enlarged text. These are browser viewport checks, not claims of physical S25 Ultra/Tab acceptance.

Evidence is recorded in the versioned publication record and GitHub CI. Existing 30–35-year engine/storage, stale-tab, offline/fallback, mutation/restore and native Android backup contracts remain enabled. Repeating unchanged optional long-duration variants is distinguished from the new mandatory boundary cases; no unrun case is reported as passed. There is no claim that every possible future fault has been excluded.

## Extended run timing evidence

The six selected long UI cases initially finished 5 passed / 1 timed out. The desktop 30-year test produced an actual ZIP with 360 trades, 360 dividends, 450 shares and 64,980 dividend cents, then exceeded its 15-minute whole-test budget; recording teardown also exceeded 30 seconds. Its incomplete trace was 242,875,249 bytes and video 72,747,495 bytes. These observations do not establish recording as the sole cause. The original failure remains recorded. A standalone repeat used the same committed test, 720 visible-form saves, all financial/restart/ZIP/rollback/reset assertions and the same 15-minute limit, with trace/video disabled and reduced-motion preference. It passed in 8.1 minutes. That establishes this functional repeat passed; it does not erase the earlier instrumented timing failure.
