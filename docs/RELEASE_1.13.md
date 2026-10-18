# DividendOS 1.13

The home dividend card now offers receipt and trade entry. A single active symbol opens its form directly; multiple symbols require an explicit destination choice. Forms name the operation on their submit buttons, repeated dividend entry is distinguished from saving and closing, and trades started from home return home after saving.

The UI uses quieter surfaces, a clear primary action, readable light/dark colors, numeric keyboards and a sticky modal title/close toolbar that prevents the close control from overlapping scrolled fields. Backup save and restore actions have distinct labels and emphasis. Empty states explain a working next step. Money semantics, financial calculations, stored ledger schema, cloud contracts and production native backup code are unchanged.

Official-source research, observations and design decisions: [UX review](UX_REVIEW_2026-10-18.md). Ten new mobile/desktop cases cover intended-symbol persistence, return navigation, nine-symbol choice, cancel/discard and 320px enlarged light/dark layouts. Existing regression and signed artifact evidence are recorded in `releases/1.13.0.publication.json`. Physical device and real account acceptance remain explicit post-update checks.

Validation completed on the final signed artifacts: 31 release suites passed; 248 mobile/desktop UI cases passed with 12 unchanged opt-in extended cases excluded; 20 focused home/form regression cases passed locally. Eight Android 16 backup instrumentation tests passed. The permanent APK certificate matched the expected certificate. Candidate run 39105332612 completed all required jobs, including signed publication verification. The initial local broad run was interrupted after 189/260 scheduled cases and is not counted as a completed run; its old-copy assertions were updated and the final CI run passed.

The metadata-only publication follow-up preserves the exact tested runtime, native source, website entry and signed ZIP fingerprints. Physical Galaxy and actual account checks remain pending after the update.
