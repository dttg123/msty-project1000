# 1.4 QA recovery

The 2026-10-12 recovery found seven final files modified locally but absent from PR #41 head b80ef085. The ordinary browser log contained the launch banner without a completion summary. No recorded error establishes the cause of the previous interruption; it must not be described as a verified pass.

## Repeatable stages

From `v4`, run `node scripts/qa-resume.mjs STAGE`, where STAGE is `release`, `browser`, `hard`, `lifetime`, `high`, or `switching`.

Each launch writes a dated log and a stage checkpoint under `v4/test-results/resume`. Browser stages also write a JSON report. A 30-second heartbeat distinguishes a running process from a lost session. Checkpoints record the exact ZIP SHA256, command, timestamps, latest output, exit code and pass/failure/interruption. A `running` checkpoint without a live process is incomplete; rerun that stage. A stage restarts from its beginning rather than treating partially entered lifetime data as complete.

Preserve logs and failed screenshots before restarting a browser stage, because Playwright clears its artifacts directory. Do not rerun a passed stage unless its inputs changed or a new unresolved failure justifies it. Never count skipped opt-in tests as passes.

## Publishing safely

Upload changed files as Git blobs, compare each returned Git blob SHA with the local file's Git SHA, then create one tree and one commit. Advance the PR branch only with the expected previous head. A changed head requires inspecting the new changes; do not force overwrite. This leaves the branch unchanged if upload stops midway and makes a completed change recoverable outside the local session.

## Separate release blockers

Current-candidate physical Galaxy S25 Ultra and actual Toss read-only evidence, backup/restore, rollback, PWA preservation and QA-data cleanup remain mandatory release evidence. The old Q3 evidence for 0.12.7 and another commit cannot be relabeled. Emulator and browser tests do not establish physical-device or actual-account completion. No release validator or workflow gate is weakened.
