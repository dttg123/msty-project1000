# DividendOS 1.8 candidate

Based on main 51ba7ffc3f41699ccd220d9e56905e8c78d0f675 and UI review 1177e137205e3a7b4aab7a9e1ecd299f0cc24a99 (PR #46).

Changes: readable multiline outcome messages, larger currency/disclosure targets,
refresh busy state, current-navigation indicator and modal keyboard focus handling.
Financial calculations, storage schema and authentication implementation are unchanged.

The production cut advances app/package/backup versions to 1.8.0, Android
versionCode to 35 and the PWA cache to dividend-os-v1.8-r1. The deterministic
40-file runtime ZIP and update manifest are signed with the existing update key;
its public key is checked against the installed native verifier before signing.
The permanent Android signing certificate is retained by the existing workflow.
Private signing material and synthetic account records are never committed.

## Verification and publication

The prior UI commit passed 202 ordinary browser checks (12 optional long-duration
cases skipped), all 30 release suites, Android backup/emulator and signed APK CI.
The 1.8 candidate reruns version-sensitive checks and CI before publication.
Current 1.8 Galaxy S25 Ultra and actual read-only Toss confirmation remain pending.
The 1.7 artifact evidence must not be relabeled or reused for changed runtime.
The existing release evidence gate is preserved. Missing evidence blocks Pages.

User approval to publish is recorded in the conversation; it is not a substitute
for user confirmation that the exact signed candidate runs on their physical device.
The tested APK and exact runtime fingerprint must be recorded after confirmation.
