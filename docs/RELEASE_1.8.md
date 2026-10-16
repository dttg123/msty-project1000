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

The 1.8 candidate passed all 30 local RELEASE suites and 38 focused browser
checks. CI run 38846319654 passed FAST, CORE, ordinary browser QA, Android
backup/emulator and the permanently signed APK. The old candidate job failed
only at its pre-publication manual-device requirement.

The user removed that circular requirement on 2026-10-16: physical confirmation
must not prevent an in-app update becoming available. CI still blocks publication
on calculations, storage, security, full browser checks, Android backup,
permanent signing and matching source-bound ZIP/runtime artifacts.
`1.8.0.publication.json` records those artifacts and explicitly leaves physical
Galaxy/Toss acceptance pending after the in-app update. No 1.7 confirmation is
reused as a 1.8 pass. Historical manual-evidence validation remains separate.

The final APK matches all 40 tested runtime files. APK SHA256:
f5dcd8d59f1cadd35f3ee990548b218c2f380bb59de818fea0a1db73051ac3be.
The permanent signing certificate is unchanged. The signed in-app update
supports the existing native app from 0.12.30 onward; no new APK is required.
