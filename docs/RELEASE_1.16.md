# DividendOS 1.16

Home removes the duplicate recent receipt card; the monthly dividend card and cashflow chart both provide access to monthly receipt history. Portfolio valuations show the quote's Korean time and the holding detail contains a single expandable explanation of purchase costs, recorded fees/taxes, dividend-inclusive returns and reference-currency conversion.

Dividend status identifies a selected usage policy rather than suggesting automatic purchases. An empty holding is labeled explicitly. Goals acknowledge pauses and external dividend use; configured monthly goals are distinguished in a new ledger. The existing settings status disclosure groups local/cloud saves, Toss review requests, file backup timestamps and automatic snapshots without treating them as interchangeable. Local storage failures and non-durable storage override the saved timestamp label.

Money calculations, persisted financial schemas and update verification keys are unchanged. Version 1.16.0 uses Android versionCode 43. Actual Galaxy/Toss account acceptance remains pending after publication.

The local release gate passed all 31 suites. The focused mobile and desktop browser run passed all 36 tests, including the 680 px portfolio limit in both mobile themes. The web update signature was verified using the public key shipped in 1.15. GitHub Actions verifies the production Android build and publication artifacts before deployment.
