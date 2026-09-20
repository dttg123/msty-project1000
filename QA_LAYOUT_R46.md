# Mobile layout review — r46 (2026-09-20)

Reference review: Stock Events official dividend tracker page (https://stockevents.app/en/dividend-tracker) and TheRich public sample portfolio (https://www.therich.io/my/portfolios), including opening its dividend calendar. These were public web views, not paid native-app testing.

Changes: home six concepts grouped into four cards; primary month-end total, paid/remaining split, inline next payout; chart duplicate totals removed; annual actual and current-holdings pace explicitly separated. Portfolio transaction/dividend actions moved into holding summary; received/available income above smaller forecast; compact chart-year selector.

360px browser iframe, same synthetic dataset before/after:
- Home main height: 1493 → 1321px.
- Portfolio main height: 1619 → 1501px.
- Dividend entry button top: 796.22 → 485.98px; height remains 48px.
- Main width and scrollWidth both 345px: no horizontal overflow.

Visual screenshots inspected: 360px dark home/portfolio; 412px light USD home and KRW lower home. Long 29,615,290원 balance remains legible. Final r46 current-month chart label visible.

Browser interactions verified: monthly chart → August paid entries (337,020원); next estimated payment → monthly dialog; home breakdown → correct SCHD entry form; MSTY dividend and trade entry forms; goal navigation; currency toggle; theme save; reload retains theme/currency and correct balances. Modal entry checks were open/cancel, not a new repeat of the previous 38-record entry test.

Data unchanged in this review: month total 272,801원 = received 209,610원 + forecast 63,191원; year received 2,249,540원; holding pace 287,529원/month. Demo data isolated from real account.

Validation: all nine npm suites passed for redesign r45; view/static suites passed again for r46 month-label fix. r46 GitHub Pages deployment succeeded (run 35521353215). The earlier 30-year manual-entry evidence is in QA_30_YEAR_R41.md; not re-performed here. Toss live integration and real-device touch testing are outside this pass. No unsupported 9/10 certification.
