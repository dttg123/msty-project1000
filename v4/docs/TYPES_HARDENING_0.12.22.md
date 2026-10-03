# DividendOS 0.12.22 TypeScript hardening

Scope: DividendOS only. Asset OS is excluded.

Explicit `any` keywords in project-owned TypeScript root sources, counted by the TypeScript AST: **1,996 → 959** (1,037 removed, 51.95%). This measures explicit keywords, not proof that all inferred values are safe; the remaining adapters and UI still contain `any`.

Completed in this release:

- Typed ledger settings, metadata, trades, dividends, splits, recovery defaults and calculation engine inputs.
- Typed portfolio events, income periods, split-adjusted dividend analytics, historical activity and home aggregates.
- Typed CSV/ZIP exports and storage interface for seven-copy automatic backups. Restored JSON remains `unknown` until validated.
- Typed cloud segments, revisions and callbacks. Cloud assembly validates object/array boundaries before integrity checks; raw restored state remains `unknown`.
- Replaced blanket Firebase URL declarations with the pinned official SDK's type-only exports. SDK remains a development dependency and is excluded from the deployed browser/APK assets. Its development-only gRPC dependency is pinned to patched 1.14.5.
- Typed Google authentication callbacks, Toss file/bridge boundary and local Android plugin contracts. Raw Toss rows remain `Record<string, unknown>` for validation/normalization.
- Typed service-worker events and synthetic demo fixtures; connected calculation types to view helper inputs.
- Compile-time contracts reject regressions in quantities, calculation outputs and validation boundaries.

Runtime fixes discovered while exposing types:

- Malformed corporate-action records are reported by ledger validation instead of throwing while dereferencing `null`.
- Non-object backup metadata is rejected with a readable error.
- Malformed cloud segment containers are rejected before assembly.
- Missing offline navigation fallback produces a failed response instead of an undefined response.

Compatibility: preserve historical cash, fees/taxes, explicit zero values, ROC behavior, input ledger rows, CSV fields, backup round trips, revision conflict handling and staged cloud revisions. Version/cache changes: 0.12.22/r83, Android versionCode 14. Existing Android plugin implementations and minimum hot-update native version remain unchanged.

## Remaining explicit any and next order

| File | Count | Next work |
|---|---:|---|
| `app.ts` | 535 | DOM controls/forms, event targets, application state, timers, cloud conflict and import callbacks |
| `modules/toss.ts` | 232 | Raw response normalization → typed orders/dividends/holdings; reconciliation, corrections and approval candidates |
| `modules/views.ts` | 136 | Typed view context/status providers, chart rows, record unions and DOM controls |
| `modules/migration.ts` | 37 | Legacy input schemas and typed audit comparisons |
| `modules/state.ts` | 19 | Backward-compatible normalization/repair of unknown legacy payloads |
| **Total** | **959** | |

Follow-up should first type Toss normalization and legacy state boundaries, then propagate those contracts through app state/forms and the view context. Retain compatibility with numeric-string legacy inputs; do not cast arbitrary restored JSON to AppState to hide errors. Run existing long-ledger, backup, browser and Android QA after every deployable stage.

Local automated QA and CI evidence belong to the matching commit/version. Synthetic browser/native-plugin tests do not establish physical Galaxy S25 Ultra, real Toss account or installed-device hot-update success. Existing Q3 device evidence must not be reused as if it were evidence for this version.
