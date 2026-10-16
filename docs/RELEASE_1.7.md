# DividendOS 1.7 release candidate

This candidate packages the funding-safety implementation reviewed in PR #44 as
app version 1.7.0, Android versionCode 34, and a distinct 1.7 service-worker cache.
The financial, import, validation, local-storage and cloud-storage implementation
is unchanged from commit 6607d6ee60881d9c396e5686c34aa263004217f5.

The earlier implementation passed 192 ordinary browser cases, 12 separately
enabled extended financial UI cases, and 30 release test suites. The extended
switching cases each reconciled 30 years, 9 projects, 707 trades, 3,240 dividends
and 2,559 withdrawals, including restart and ZIP restoration. These results are
baseline evidence, not a claim that the 1.7 physical-device checks are complete.

## Publication checks

- The 1.7 ZIP contains only the 40 runtime build files and their hash manifest.
- ZIP contents, SHA-256 and the installed native RSA public key must agree.
- The existing permanent Android signing certificate must be retained.
- The hardening/release-1.7 branch runs the ordinary browser, Android file-backup,
  permanently signed APK, release-suite and existing Q3-evidence checks before
  production publication. A successful APK build is not production deployment.
- docs/QA_RESUME.md requires current-candidate physical Galaxy S25 Ultra and
  actual Toss read-only evidence. Emulator and fixture tests do not replace it.
- Main publication and the existing Q3 validator are not bypassed by the
  candidate workflow. Missing or stale evidence remains a release blocker.

## Data preservation

The funding ledger reads the former local/cloud ledger once into a separate
namespace. Old clients must not silently overwrite the funding ledger, and
stale local tabs cannot overwrite a newer save. All devices should use the new
client after migration; later old-client edits are not automatically merged.

Broker originals and private statement reconciliations are not bundled in the
public application. No personal records, credentials or synthetic QA records
are included in the production ZIP.

## Recovery

Keep a user-exported ZIP before installation. Preserve the former ledger and
cloud root. A code rollback must not copy the funding ledger into the old client
or discard source-bound funding metadata. The app's safety copy and checked ZIP
restore remain the data-recovery path. Do not downgrade and enter new records in
an old client after a funding-ledger migration.

## Verified 1.7 evidence and deployment correction

The user confirmed installation of the signed 1.7 candidate, home/portfolio/goals,
retained records after restart, and actual Toss refresh without duplicates.
These are user-attested physical checks, not agent-performed device tests.
`docs/releases/1.7.0.json` records the APK digest, tested source commit, all 40
runtime file digests, native source/dependency digest, signed update manifest
and ZIP, and the relevant automated CI runs.

The previous repository-wide Q3 variable remained bound to an older exact Git
commit. Even documentation-only descendants invalidated that record. Separately,
legacy branch-based Pages publishing could succeed while the quality workflow
failed. This explains why an earlier version appeared deployed despite the same
Q3 mismatch; it does not establish that earlier application calculations failed.

The corrected Q3 gate accepts only descendants of the tested source with identical
runtime, native inputs, root website entry files, signed ZIP and update manifest.
Changes to those files require new evidence; documentation and QA changes do not
require a new APK installation. Invalid, expired, foreign or incomplete evidence
still fails. The release PR now runs this gate before merging. Production Pages
publishing is downstream of the release gate and signed Android build, with the
repository Pages source set to GitHub Actions at rollout.

Regression tests cover unchanged descendants, modified runtime/storage/native and
update files, absent APK evidence, expired/future evidence, missing device flows,
pending Toss checks and unclean QA state. Financial source and signed app runtime
remain identical to the device-tested candidate.
