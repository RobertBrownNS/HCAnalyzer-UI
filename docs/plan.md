# Task Board: Phases 1–2

Branch: `feature/phase-1-2`. Scope this round: Phase 1 (data pipeline) and Phase 2 (MVP explorer). Then stop for user review.
Related: [decisions.md](decisions.md) · [risks.md](risks.md) · [data-layout.md](data-layout.md) (data engineer owns it)

Status values: `todo` · `in-progress` · `review` (waiting on QA) · `done` · `blocked`

Owners: **DE** data engineer · **FE** frontend engineer · **TE** transform engineer · **QA** QA/skeptic · **PM** project manager

---

## Phase 1: Data pipeline

| ID | Task | Owner | Depends on | Status |
|---|---|---|---|---|
| P1-01 | Inspect EDR xlsx structure, document in `docs/data-layout.md` | DE | none | todo |
| P1-02 | Set up `data/raw/` and source manifest | DE | none | todo |
| P1-03 | Fetch population (EDR) and CPI (BLS CPI-U + Tampa) raw files | DE | P1-02 | todo |
| P1-04 | Parse revenue/expenditure xlsx to `Observation[]` | DE | P1-01, P1-02 | todo |
| P1-05 | Population and CPI series to year-keyed JSON | DE | P1-03 | todo |
| P1-06 | Emit versioned `src/assets/data/*.json` + `Source` records | DE | P1-04, P1-05 | todo |
| P1-07 | Validation report `data/validation.md` | DE | P1-06 | todo |
| P1-08 | Pipeline unit tests | DE | P1-04 | todo |
| P1-09 | QA review of Phase 1 (hand re-derivation) | QA | P1-07 | todo |

### Acceptance criteria

**P1-01 Inspect xlsx layout**
- [ ] `docs/data-layout.md` documents, per workbook: sheet names, header row position(s), how fiscal years are laid out, fund columns (including Custodial from FY 2020-21), total and per-capita columns, account-code column format, and any merged cells, footnotes, or blank-row conventions.
- [ ] It lists at least one cell reference per workbook that QA can check by hand, for example "FY 2023-24, account 311, General Fund = $X at Sheet!C42".
- [ ] It records whether EDR Total/Per Capita columns are values or formulas in the downloaded file.
- [ ] Parser code is written after this doc exists, not before (CLAUDE.md: "Do not assume column layout").

**P1-02 Raw data and manifest**
- [ ] Existing workbooks are moved from `finance_data/` to `data/raw/`, byte-identical (sha256 matches before and after).
- [ ] `data/raw/manifest.json` records for every raw file: source URL, publisher, retrieved date (ISO), sha256, and byte size.
- [ ] Raw files are never modified in place.

**P1-03 Population and CPI raw files**
- [ ] Population: EDR official county estimates covering FY 2005–2025 for Hillsborough. The file and the table name are recorded.
- [ ] CPI: BLS CPI-U U.S. city average, all items, NSA (series `CUUR0000SA0`), plus the Tampa–St. Petersburg–Clearwater all-items series. Monthly or bimonthly/semiannual frequency and the start year are recorded for each.
- [ ] If the Tampa series does not cover the full range (BLS Tampa index base is Dec 2017 = 100, so it is expected to start around 2018; DE confirms), that gap is recorded in `Source.caveats`. No gaps are filled with values from another series without a visible caveat.

**P1-04 Parse to Observations**
- [ ] Every row conforms to `Observation` from CLAUDE.md. `fiscalYear: 2021` means FY 2020-21.
- [ ] `fundType` maps every AFR fund column. Custodial is `'custodial'`. No column is silently dropped; unmapped columns fail the build.
- [ ] Rows that are EDR subtotals or totals are not emitted as Observations (no double counting). They are kept separately for validation only.
- [ ] `account` keeps the code exactly as the source has it (string, leading zeros preserved).
- [ ] `amount` is nominal USD exactly as published. No rounding in the pipeline.
- [ ] Revenue and expenditure are distinguishable (by account range or an explicit field, documented in data-layout.md).

**P1-05 Population and CPI series**
- [ ] Output is year-keyed JSON with `sourceId` on each series.
- [ ] The year-alignment rule (calendar vs fiscal Oct–Sep average, April 1 estimate vs FY) is implemented exactly as recorded in decisions.md O-03 (CPI) and O-05 (population). The rule is written in the output JSON metadata.
- [ ] Partial-year CPI averages are not emitted. If a year has incomplete months, it is excluded and flagged.

**P1-06 Emit JSON**
- [ ] `npm run pipeline` runs end to end with no network access once `data/raw/` exists (fetching is a separate script).
- [ ] Output is deterministic: two consecutive runs produce byte-identical JSON (stable key order, stable row sort, no timestamps other than recorded retrieval dates).
- [ ] Each output file has a sha256 recorded in a manifest. The manifest has a schema/data version.
- [ ] Every Observation's `sourceId` resolves to a `Source` with publisher, title, url, retrieved, sha256, and caveats.
- [ ] The GASB 84 `Annotation` at `fiscalYear: 2021` (kind `methodology`, label "Custodial fund reporting begins (GASB 84).") is emitted with a sourceId.
- [ ] The pipeline is county-agnostic: the county is a parameter. Only Hillsborough is processed.

**P1-07 Validation report**
- [ ] For every fiscal year, revenues and expenditures: sum of parsed Observations per fund equals the EDR source total row/column, to the cent. The report lists each year with a pass/fail mark.
- [ ] For FY 2021+, sum excluding custodial equals the EDR total recalculated without the Custodial column, per year.
- [ ] Per-capita check: the recalculated total divided by the EDR population used in the workbook matches the EDR Per Capita column within rounding. The tolerance is stated.
- [ ] Any mismatch fails `npm run pipeline` (non-zero exit), unless it is listed in an explicit, reviewed allowlist with a reason.
- [ ] The report states the counts: number of years, accounts, funds, and observations.

**P1-08 Pipeline tests**
- [ ] Tests cover: header detection, FY label parsing ("2020-21" → 2021), custodial column detection, subtotal exclusion, and an unknown-column failure.
- [ ] Tests run in CI-equivalent `npm test` without network access.

**P1-09 QA review**
- [ ] QA re-derives by hand, from the raw xlsx, at least 5 values (including one pre-2021 and one post-2021 total with and without custodial) and records the cell references.
- [ ] QA confirms no advocacy-group figures appear anywhere in data or sources.
- [ ] Findings are logged in the Findings log below. Phase 1 is not done while there are open blocker findings.

### Phase 1 Definition of Done
- [ ] All P1 tasks `done`. P1-09 has no open blocker findings.
- [ ] `npm run pipeline` is green and deterministic (checksums stable across 2 runs).
- [ ] `data/validation.md` is all-pass (or each exception is allowlisted with a reason).
- [ ] Every emitted number traces to publisher, file, account code, fiscal year, and retrieval date.
- [ ] `docs/data-layout.md` is complete. decisions.md is updated with any choices made during parsing.

---

## Phase 2: MVP explorer

| ID | Task | Owner | Depends on | Status |
|---|---|---|---|---|
| P2-01 | Upgrade Angular 17.3 to latest (stepwise `ng update`), CLI-default test runner | FE | none | todo |
| P2-02 | Add `ngx-echarts` + Angular Material; theme tokens, light/dark | FE | P2-01 | todo |
| P2-03 | `src/app/core/models.ts` (Observation, Source, Annotation) | TE | P1-01 | todo |
| P2-04 | Pure `transform.ts` + exhaustive tests | TE | P2-03, P1-05 | todo |
| P2-05 | Data loading service (static JSON, checksum check) | FE | P1-06, P2-01 | todo |
| P2-06 | URL-state service (query params ↔ signals) | FE | P2-01 | todo |
| P2-07 | Controls: measure, base year, range, custodial, inflation index | FE | P2-06 | todo |
| P2-08 | Line chart with GASB 84 annotation, range slider, pinch-zoom | FE | P2-02, P2-04, P2-05 | todo |
| P2-09 | View-as-table toggle | FE | P2-08 | todo |
| P2-10 | Mobile-first layout, chip row, bottom sheet | FE | P2-07 | todo |
| P2-11 | Minimal source/provenance display | FE | P2-05 | todo |
| P2-12 | QA review of Phase 2 | QA | P2-04..P2-11 | todo |

### Acceptance criteria

**P2-01 Angular upgrade**
- [ ] `ng version` reports the latest stable Angular. Updated one major at a time with `ng update`.
- [ ] Standalone components only, no NgModules. `ng build` and `ng test` are green.

**P2-02 Libraries and theme**
- [ ] `ngx-echarts` and Angular Material are installed and compatible with the Angular version.
- [ ] Light and dark themes follow `prefers-color-scheme` and have a manual override. The chart re-themes on switch.
- [ ] The chart palette is colorblind-safe (documented choice). Text contrast meets WCAG AA in both themes.

**P2-04 transform.ts**
- [ ] It is pure: no Angular imports, no I/O, no `Date.now()`, no mutation of inputs. Same input gives deep-equal output.
- [ ] It implements: custodial include/exclude filter; fund-scope filter hook; per-resident join with population; CPI deflation to a selectable base year and index (national/Tampa); index-to-100; FY label `fiscalYear 2021 → "FY 2020-21"`.
- [ ] Missing population or CPI for a year gives an explicit gap (null plus reason), never 0, never interpolated silently.
- [ ] Deflation formula `real = nominal × CPI[base] / CPI[year]` is tested with hand-computed fixtures. Base-year value equals nominal.
- [ ] FY label edge cases are tested: 2000 → "FY 1999-00", 2010 → "FY 2009-10", 2021 → "FY 2020-21".
- [ ] Coverage is ~100% lines and branches for `transform.ts`.
- [ ] The output carries the provenance needed by the UI (sourceIds for amount, population, CPI per point).

**P2-05 Data loading**
- [ ] It loads only bundled static JSON. No runtime calls to state or BLS sites, no tracking, no third-party requests.
- [ ] A data version mismatch or missing file shows a clear error state, not an empty chart.

**P2-06 URL state**
- [ ] Every control is a signal mirrored to query params (for example `measure`, `base`, `from`, `to`, `custodial`, `cpi`).
- [ ] Round-trip: set controls, copy URL, open in a fresh tab, get an identical view (all control values deep-equal). Covered by a test.
- [ ] Invalid or out-of-range params fall back to defaults and do not crash. Defaults are not written to the URL unnecessarily (stable short links).
- [ ] Back/forward navigation restores the previous states.

**P2-07 Controls**
- [ ] Measure: nominal / per resident / inflation-adjusted / per resident + inflation-adjusted.
- [ ] Base year: any year in the data. Range: slider plus presets. Inflation index: CPI-U national vs Tampa.
- [ ] Custodial: include/exclude, **default exclude**.
- [ ] Controls are signals. Chart data is a single `computed` derived from them via `transform.ts`.
- [ ] The current methodology settings (measure, base year, index, custodial, fund scope) are always visible on screen as chips, never hidden.

**P2-08 Line chart**
- [ ] The x-axis shows `FY 2020-21` style labels, never bare `2021`.
- [ ] A vertical annotation at FY 2020-21 reads "Custodial fund reporting begins (GASB 84)." It is visible in every measure and range that includes FY 2021, and in both custodial settings.
- [ ] Pinch-zoom works on touch. A dataZoom slider sits under the chart.
- [ ] The y-axis unit label changes with the measure (for example "USD, nominal" / "USD per resident, FY 2024-25 dollars, CPI-U").
- [ ] Tooltip values equal the table values exactly (same formatter).

**P2-09 View as table**
- [ ] A toggle shows the same series as a table: FY label, value, unit, and source reference per row.
- [ ] Table values equal chart values (test asserts this from the same `computed`).
- [ ] The table is accessible: real `<table>` with headers. Screen-reader friendly.

**P2-10 Layout**
- [ ] At phone width (360–430px), the chart is ~60% of viewport height, with a chip row of active settings. Tapping a chip opens a bottom sheet. No horizontal page scroll.
- [ ] Tablet: collapsible side panel. Desktop: persistent left controls.
- [ ] All touch targets are ≥ 44×44 CSS px (verified by measuring in devtools for chips, toggles, slider handles, and table toggle).

**P2-11 Provenance display**
- [ ] A visible "Sources" area lists every Source used by the current view: publisher, title, URL, retrieved date, and caveats.
- [ ] No number appears on screen without a reachable source.

**P2-12 QA review**
- [ ] Neutrality sweep: no editorial copy, no adjectives about growth ("soaring", "modest"), no verdicts, and no advocacy-group data anywhere in the UI or assets.
- [ ] Spot-check 3 chart values against `data/validation.md` and the raw xlsx, by hand, for each measure.
- [ ] Spot-check inflation-adjusted values with a hand-calculated CPI ratio.
- [ ] Verify the custodial default, the GASB 84 marker, FY labels, URL round-trip, 44px targets, and light/dark at phone width.
- [ ] Findings are logged below. Phase 2 is not done while there are open blocker findings.

### Phase 2 Definition of Done
- [ ] All P2 tasks `done`. P2-12 has no open blocker findings.
- [ ] `ng build` and `ng test` are green. `transform.ts` coverage is ~100%.
- [ ] `ng serve` at phone width: toggles change the chart, the URL reproduces the view, the GASB 84 marker is visible, and the table matches the chart.
- [ ] Custodial is excluded by default. Methodology settings are always visible.
- [ ] No editorial copy. Every displayed number traces to a Source.
- [ ] The PM end-of-round summary is written, with open decisions re-raised to the user.

---

## Findings log (QA)

| ID | Phase/Task | Severity (blocker/major/minor) | Finding | Owner | Status |
|---|---|---|---|---|---|
| none yet | | | | | |
