# DividendOS storage V2 (1.11)

Local storage is a new IndexedDB ledger (`DividendOSDB_LedgerV2`). Transactional heads hold ordered collection descriptions and SHA-256 checksums; individually keyed rows retain unknown fields, duplicate identifiers and Toss source records. One edit writes its affected rows and the head in one strict transaction. Unchanged snapshots do not invalidate another open tab. Revision comparison rejects stale writes.

Migration reads the previous funding ledger or its durable localStorage fallback, writes the new ledger, and verifies exact reconstruction. It retains the previous source. Later changes from an older app stop automatic writes instead of silently replacing either source. Tombstones prevent deleted records from being imported again. After a primary V2 ledger exists, an unavailable database produces a recovery error instead of falling back to an obsolete copy.

Automatic recovery keeps at most seven gzip snapshots within a 16 MiB serialized payload budget. Payload, index and pruning are atomic in IndexedDB. Old uncompressed backups remain readable. An oversized or failed new backup does not prune the prior recovery copies. localStorage retains the previous safe write order; it cannot supply a multi-key transaction. Memory-only mode never claims durable storage. Portable ZIP exports retain their existing compatible format.

Cloud storage uses the separate `dividend-os-ledger-v2` namespace. Content-addressed immutable segments are reused between revisions; only changed segments are uploaded. A transaction publishes the head after staging and compares the expected revision and any migrated source fingerprint. Readers verify each segment and the reconstructed full-state checksum. Cleanup retains current/previous published content, recent staging and future revisions. Previous namespaces are not mutated.

## Verification

- Real Chromium IndexedDB: migration/reload, exact single-row writes, row-write abort/retry, backup transaction abort, stale tabs, legacy edits, fallback migration, deletion, duplicate IDs and ordering, 35-year nine-symbol roundtrip (16,380 dividends and 3,780 trades).
- Production cloud adapter with an isolated transactional facade: unchanged-segment reuse, staging/network/publish failures, revision conflicts and garbage-collection safety. This is not a live Firestore or physical-device test.
- Seven compressed 35-year backup restores compared by canonical SHA-256; old plain backups, damaged gzip rejection, budget failure preservation.
- Existing release suites and complete mobile/desktop UI regression run before publication; exact results recorded separately.

## Limits

The financial engine still reconstructs the full ledger in memory and computes whole-state checksums. Writes are incremental; this does not make every operation constant-time. A single local or cloud state is bounded at 32 MiB. Browser eviction, app-data deletion, a lost device and revoked cloud access cannot be prevented by a local ledger; exported backups remain necessary for independent recovery. Actual Galaxy/Toss acceptance is recorded after the in-app update and is not represented as automated evidence.
