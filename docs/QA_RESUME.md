# 1.4 QA recovery

The 2026-10-12 recovery found seven final files modified locally but absent from PR #41 head b80ef085. The ordinary browser log contained the launch banner without a completion summary. No recorded error establishes the cause of the previous interruption; it must not be described as a verified pass.

## Repeatable stages

From `v4`, run `node scripts/qa-resume.mjs STAGE`, where STAGE is `release`, `browser`, `hard`, `lifetime`, `high`, or `switching`.

Each launch writes a dated log and a stage checkpoint under `v4/test-results/resume`. Browser stages also write a JSON report. A 30-second heartbeat distinguishes a running process from a lost session. Checkpoints record the exact ZIP SHA256, command, timestamps, latest output, exit code and pass/failure/interruption. A `running` checkpoint without a live process is incomplete; rerun that stage. A stage restarts from its beginning rather than treating partially entered lifetime data as complete.

Preserve logs and failed screenshots before restarting a browser stage, because Playwright clears its artifacts directory. Do not rerun a passed stage unless its inputs changed or a new unresolved failure justifies it. Never count skipped opt-in tests as passes.

## Publishing safely

Upload changed files as Git blobs, compare each returned Git blob SHA with the local file's Git SHA, then create one tree and one commit. Advance the PR branch only with the expected previous head. A changed head requires inspecting the new changes; do not force overwrite. This leaves the branch unchanged if upload stops midway and makes a completed change recoverable outside the local session.

## Publication and manual acceptance (revised 2026-10-16)

The user explicitly removed the requirement to install a candidate APK and
perform physical-device checks before an in-app update can be published.
Publication now requires FAST/CORE/RELEASE, full ordinary browser QA,
Android backup/emulator checks, the permanently signed APK/certificate check,
and artifact-bound signed ZIP/runtime verification. All remain blocking.
A publication record must match the tested source, runtime, native inputs,
website entry files and signed ZIP/manifest; stale or changed artifacts fail.

Physical Galaxy S25 Ultra and actual Toss read-only checks happen after the
user receives the in-app update. They remain explicitly pending until the user
confirms them. Emulator/browser results never become physical-device evidence.
The historical strict manual-evidence validator remains available for recording
and validating manual acceptance; it is not a prerequisite for publication.
Do not relabel old 0.12.7/1.7 evidence as current 1.8 device confirmation.
QA ledgers and credentials must never be included in production bundles.
