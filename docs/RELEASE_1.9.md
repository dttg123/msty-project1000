# DividendOS 1.9

The home dividend card now focuses on received income and progress toward the monthly goal. Payout counts and the misleading comparison of a partial month against the whole previous month are removed from that card; receipts and period charts remain available. Long amounts use smaller type, and completed goals show a concise completion message.

Cloud status no longer reads local-save text from the DOM. Local saves preserve outstanding cloud conflicts and failures. Login alone does not imply a successful cloud save, and the end of a connection attempt cannot clear a failed write. Settings show the current cloud state and last acknowledged save separately. The unconditional legacy migration warning and the static green connection dot are removed. Conflicting cloud/local data still require explicit selection; neither version is silently overwritten.

## Design reference and scope

Public Korean references reviewed on 2026-10-16:
- The Rich portfolio/calendar: https://www.therich.io/portfolio/4ohtm2hn8ez
- The Rich monthly income goals: https://www.therich.io/portfolio-generator/option
- Domino developer listing: https://play.google.com/store/apps/details?id=com.favv.neo&hl=ko
- Toss navigation research: https://toss.im/tmc-25/sessions/design/ux-research-10

These are public reference materials, not claims of hands-on use of authenticated competitor apps. Apply concise summaries, period-to-receipt navigation and clear feedback. Do not add news, community, rankings, extra tabs or unverified payout forecasts.

## Validation

Synthetic browser contexts only; cloud calls mocked and live external requests blocked for new layout scenarios. Cases cover no recorded holdings, one/six/nine symbols, large amounts, 320/412px widths, light/dark themes and enlarged text. Existing checks cover 30-year records, modal focus, graph selection, settings scroll/disclosure preservation and repeated navigation. Test assertions verify ledger preservation, retained conflict state after local writes and honest cloud-failure reporting.

Local review: 40 focused browser checks plus two cloud-failure checks passed before release packaging. Final package checks and CI are recorded with the publication evidence. Actual Galaxy/Toss acceptance remains pending after the in-app update; it is not a prepublication requirement and is not claimed by automated tests. Native version metadata advances to 1.9.0/36; this is a signed web update compatible with the existing native update verifier and does not require reinstalling the APK.
