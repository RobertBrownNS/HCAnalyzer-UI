# Decision Log

Format: ID · decision · status · rationale · reversibility. Statuses: **assumed** (default taken because the user didn't answer, can be reversed), **decided** (user confirmed), **open** (needs the user).

## Assumed defaults (user unavailable at kickoff, 2026-10-06)

| ID | Decision | Status | Rationale | Reversibility |
|---|---|---|---|---|
| D-01 | Upgrade Angular 17.3 to latest stable before writing app code | assumed | Scaffold has no app code yet, so migration is cheap now and costly later. CLAUDE.md says "Angular (latest)". | Easy now, hard later |
| D-02 | This round covers Phases 1–2 only, then stops for user review | assumed | Gets a checkpoint before the methodology-heavy phases (breakdowns, comparisons, presets). | Easy |
| D-03 | Pipeline is county-agnostic (county is a parameter). Only Hillsborough is processed. | assumed | Comparison set is undecided (O-01). Avoids rework in Phase 4. | Easy |
| D-04 | Treat the site as public: methodology and provenance hooks are first-class from the start | assumed | Safer default. Adding provenance later is costly; it's cheap to keep if the site stays personal. | Easy |
| D-05 | Pipeline written in Node/TypeScript | assumed | One toolchain with the Angular app. Shared model types. Python env lacks openpyxl. | Moderate |
| D-06 | Custodial EXCLUDED by default; GASB 84 annotation at FY 2020-21 always shown | decided (CLAUDE.md) | Pre/post FY 2020-21 years are not comparable otherwise. | n/a |

## Open decisions for the user

Until answered, the team uses the **interim default** shown. Each one is visible in the UI or methodology notes so users can see it.

| ID | Question | Options | Interim default | Who's blocked |
|---|---|---|---|---|
| O-01 | Which comparison counties? | (a) Neighbors: Pinellas, Pasco, Polk · (b) Peers: Orange, Duval, Palm Beach · (c) All 67 + statewide | None processed. Pipeline stays county-agnostic. | Phase 4 only |
| O-02 | Public or personal? Hosting target? | Public (GitHub Pages / Netlify / Cloudflare Pages / Azure Static Web Apps) vs personal/local | Public-ready, static build, no host chosen. Base href configurable. | Deploy only |
| O-03 | CPI year alignment | (a) Fiscal-year average, Oct–Sep, matches county FY · (b) Calendar-year annual average (BLS published) | **(a) fiscal-year Oct–Sep average** for CPI-U monthly. Shown in the y-axis label/methodology. See R-05. | P1-05, P2-04 |
| O-04 | Default inflation index | National CPI-U vs Tampa–St. Pete–Clearwater CPI | **National CPI-U**: covers the full FY 2005–2025 range and is monthly. Tampa is offered as an option with its coverage caveat. | P2-07 |
| O-05 | Population year alignment | (a) April 1 estimate of the year the FY starts (e.g., Apr 2020 for FY 2020-21) · (b) April 1 of the year the FY ends · (c) whatever population EDR used in its own Per Capita column | **(c) EDR's own choice**, so our per-capita matches EDR's published per-capita. DE documents which one that is. | P1-05, P2-04 |
| O-06 | How to map account codes to categories (ad valorem, public safety, transportation, etc.) | (a) Uniform Accounting System (UAS) chart-of-accounts groupings as published by DFS · (b) custom grouping | **(a) UAS groupings**, with the mapping table published and sourced. Not needed for the Phase 2 MVP (totals only). | Phase 3 |
| O-07 | Should "all funds" include enterprise funds by default? | Include vs exclude enterprise (and internal service) funds | Phase 2 shows totals across all non-custodial funds, matching EDR totals so validation holds. The fund-scope control with a default choice comes in Phase 3. | Phase 3 |

## Decisions made during the round

Append here as team members make choices (for example, how subtotal rows are detected, CPI tolerance). Include who decided and why.

| ID | Date | Decision | By | Rationale |
|---|---|---|---|---|
| none yet | | | | |
