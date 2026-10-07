# Task Board: Phases 1–2

Branch: `feature/phase-1-2`. Scope this round: Phase 1 (data pipeline) and Phase 2 (MVP explorer). Then stop for user review.
Related: [decisions.md](decisions.md) · [risks.md](risks.md) · [data-layout.md](data-layout.md) (data engineer owns it)

Status values: `todo` · `in-progress` · `review` (waiting on QA) · `done` · `blocked`

Owners: **DE** data engineer · **FE** frontend engineer · **TE** transform engineer · **QA** QA/skeptic · **PM** project manager

---

## Phase 1: Data pipeline

| ID | Task | Owner | Depends on | Status |
|---|---|---|---|---|
| P1-01 | Inspect EDR xlsx structure, document in `docs/data-layout.md` | DE | none | review |
| P1-02 | Set up `data/raw/` and source manifest | DE | none | review |
| P1-03 | Fetch population (EDR) and CPI (BLS CPI-U + Tampa) raw files | DE | P1-02 | review |
| P1-04 | Parse revenue/expenditure xlsx to `Observation[]` | DE | P1-01, P1-02 | review |
| P1-05 | Population and CPI series to year-keyed JSON | DE | P1-03 | review |
| P1-06 | Emit versioned `src/assets/data/*.json` + `Source` records | DE | P1-04, P1-05 | review |
| P1-07 | Validation report `data/validation.md` | DE | P1-06 | review |
| P1-08 | Pipeline unit tests | DE | P1-04 | review |
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
- [ ] If the Tampa series does not cover the full range (the bimonthly series CUURS35DSA0, base 1987 = 100, starts Nov 2017, so fiscal-year values cover FY 2018–2025 only; the semiannual series CUUSS35DSA0 gives calendar-year averages back to 2000 but no Oct–Sep values; see decisions DR-10), that gap is recorded in `Source.caveats`. No gaps are filled with values from another series without a visible caveat.

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
| P2-03 | `src/app/core/models.ts` (Observation, Source, Annotation) | TE | P1-01 | done |
| P2-04 | Pure `transform.ts` + exhaustive tests | TE | P2-03, P1-05 | done |
| P2-05 | Data loading service (static JSON, checksum check) | FE | P1-06, P2-01 | todo |
| P2-06 | URL-state service (query params ↔ signals) | FE | P2-01 | todo |
| P2-07 | Controls: measure, base year, range, custodial, inflation index | FE | P2-06 | todo |
| P2-08 | Line chart with GASB 84 annotation, range slider, pinch-zoom | FE | P2-02, P2-04, P2-05 | todo |
| P2-09 | View-as-table toggle | FE | P2-08 | todo |
| P2-10 | Mobile-first layout, chip row, bottom sheet | FE | P2-07 | todo |
| P2-11 | Minimal source/provenance display | FE | P2-05 | todo |
| P2-12 | QA review of Phase 2 | QA | P2-04..P2-11, P2-13 | todo |
| P2-13 | Apply theme D "BI dashboard" (decisions D-07) | FE | P2-02 | todo |

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
- [ ] Tablet: collapsible side panel. Desktop: persistent filters pane on the **right** (user decision D-07 overrides CLAUDE.md's "left").
- [ ] All touch targets are ≥ 44×44 CSS px (verified by measuring in devtools for chips, toggles, slider handles, and table toggle).

**P2-11 Provenance display**
- [ ] A visible "Sources" area lists every Source used by the current view: publisher, title, URL, retrieved date, and caveats.
- [ ] No number appears on screen without a reachable source.

**P2-13 Apply theme D "BI dashboard"**
- [ ] All design tokens (color, type, spacing, radius, elevation) are defined in one file. Components use tokens only, with no hard-coded colors.
- [ ] It matches the mockup in structure: navy top bar, tiles on a grey canvas, KPI cards, filters pane on the right on desktop. It is a single-chart layout; multi-tile layouts are Phase 3+.
- [ ] Light and dark both work, including the chart, KPI cards and table. Text meets WCAG AA contrast in both.
- [ ] All touch targets are ≥ 44×44 CSS px at phone width.
- [ ] **KPI neutrality:** every KPI value derives only from the user's current range, base year, measure and index settings. There are no comparison periods we pick, and no green/red or up/down good/bad coloring. Change values use the same neutral color whatever their sign. A test asserts that KPI values equal `transform.ts` outputs for the current settings.
- [ ] IBM Plex Sans and IBM Plex Mono are self-hosted from `src/assets`. The network tab shows no requests to Google Fonts or any other third-party font host.

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

P1-09 review of commit `6d13a2e` (2026-10-06). Independent checker: `python -I qa/phase1/independent_check.py`. It uses only the Python standard library to read the raw OOXML (zipfile + ElementTree) and shares no code with the pipeline, which uses exceljs. It exits 0.

**Verified with no defects found:**
- All 6,924 observations match the raw xlsx cell by cell: amount, account string, fund, FY and `ref`. Both directions were checked, with 0 missing, 0 extra and 0 mismatched. The reader found no hidden rows or columns and no numeric cells in unmapped columns.
- Per-fund and grand totals match the workbook's "Total - All Account Codes" row for all 41 sheets. Per-capita matches within 1e-6.
- The Custodial column exists only from FY 2020-21. Totals excluding custodial equal Total − Custodial, which is EDR's recalculation (for example, FY 2024-25 revenue $9,597,307,134 − $4,128,975,000 = $5,468,332,134).
- Hand values with cell refs: rev FY 2005-06 total $3,124,444,095 (`2006!N151`). Rev FY 2021-22 total $10,398,646,000, or $3,583,795,000 excluding custodial (`2022!P154`, `2022!K154`). Rev FY 2024-25 as above (`2025!P134`, `2025!K134`). Exp FY 2004-05 total $2,734,662,503 (`2005!N94`). Exp FY 2021-22 $3,462,998,121, or $3,456,196,000 excluding custodial.
- 20 random `ref` spot checks (seed 20261006) all match.
- FY mapping: every sheet's row-2 title "Fiscal Year Ended September 30, YYYY" equals the sheet name, including `2005` (exp) and `2006` (rev).
- Population: all 21 years (FY 2004-05 to FY 2024-25) equal the FLcopops.xlsx Hillsborough value and the workbook's own population row. 2010 uses the census count and 2020 the revised BEBR estimate, as documented in DR-08.
- CPI: I re-derived the national FY 2005-06, 2006-07, 2019-20, 2020-21, 2021-22 and 2024-25 averages, and Tampa FY 2017-18, 2020-21 and 2024-25, from the raw BLS JSON. All match. FY 2025-26 national is null because Oct 2025 is missing (BLS footnote "X"). Tampa FY values before FY 2017-18 are null with a reason, so nothing is spliced.
- Provenance: all 7 `Source.sha256` values equal the recomputed raw-file hashes, and every observation's `sourceId` resolves to the right flow's source. The manifest output hashes and byte counts match, and no files are unlisted. The GASB 84 caveat text appears verbatim in `data/raw/edr/cntyfiscal.html`.
- Determinism: a fresh `git clone` with `core.autocrlf=true` keeps the raw hashes intact. `npm run pipeline` ran twice in that clone and gave byte-identical outputs, and those equal the committed outputs (clean `git status`). Appending one byte to a raw file makes the build refuse to run.
- Accounts: no codes have more than 3 decimals and there are no 3-dp collisions. Expenditure codes are all integers. The 367 exception reproduces independently for FY 2009-10 to FY 2018-19 only.
- Neutrality: a grep of outputs, the validation report, data-layout.md and the pipeline source found no advocacy-group names or loaded adjectives.

**Re-verification at `f4cea65` (2026-10-06, after fixes in `cd7662a` and `fb1ac15`):** independent checker 0 FAIL. Fresh `autocrlf=true` clone: 36 tests pass, `npm run pipeline` ran twice with no diff against the committed outputs. County AFR cross-check: all 9 hand-read values in `county-afr-checks.ts` were found independently with `pdftotext -layout` (DE used `-raw`). Each amount appears exactly once in its PDF, on the cited page. Every other fund's EDR amount for the same rows also appears (for example, FY 2024 581 governmental row total $1,310,890,615; FY 2023 581 row total $1,160,934,246), so the General Fund column attribution holds. PDF headers confirm entity, FY and received dates; hashes match. Pages could not be rendered as images (no pdftoppm), so the check is text-level only. `buildSeries` scratch checks: nominal totals equal independent sums. FY 2024-25 per-resident $3,470.55 and Tampa-fiscal real (base FY 2019-20) $4,154,835,039 match hand calculation. Annotation filters (flow, custodial, measures) and transfer-imbalance notes behave as intended in gross/net and custodial include/exclude.

| ID | Phase/Task | Severity (blocker/major/minor) | Finding | Owner | Status |
|---|---|---|---|---|---|
| QA-01 | P1 data / P2–P3 display | **major** | **Source-classification break in FY 2022-23 and FY 2023-24 expenditures. Nothing in the data surfaces it.** Revenue 381 (transfers in) equals expenditure 581 (transfers out) within $601 in 19 of 21 years. In FY 2022-23, 581 exceeds 381 by **$624,603,841**. In FY 2023-24 it exceeds it by **$535,878,141**. In the same two years: account 521 Law Enforcement is $0.6M and $9.0M (`2023!D16`=203,849, `2024!D16`=150,746), against $511M in FY 2021-22 and $716M in FY 2024-25 (`2025!D16`=680,677,907). General Fund 581 is $787M and $912M (`2023!D57`, `2024!D57`), against $121M and $341M in the years either side. The public_safety section (non-custodial) is $387M and $368M, against $883M and $1,300M. FY 2023-24 also has Enterprise 536 Water-Sewer at $0 (`2024!I29`; $235M in FY 2022-23, $239M in FY 2024-25), Internal Service 519 at $18.9M (`2024!J14`; $232M and $243M either side), and Component Units at $0. Headline effect: total expenditures excluding custodial change −12.6% (FY 2023-24), then +47.7% (FY 2024-25). The pipeline transcribes the workbook correctly. The problem is that a chart would show "law enforcement spending fell 99%" or "public safety tripled" with no annotation. | DE (detect), PM (decide wording) | **partly resolved** (re-verified at `f4cea65`): imbalance check, YoY tables, FY 2023 and FY 2024 annotations and source caveats added. Traced to the county-filed AFR, and QA confirmed all 9 values in the PDFs. Still open: the FY 2023-24 Enterprise and Internal Service gap is not annotated (see QA-09) |
| | | | *Suggested fix:* (1) Add validation NOTE checks for 381 vs 581 imbalance and for large YoY swings by section and fund, so future refreshes flag these automatically (R-07/R-08). (2) Emit `Annotation`s at FY 2023 and FY 2024 (kind `methodology`, neutral wording such as "Reporting classification differs from adjacent years: transfers out exceed transfers in by $X; see source caveats"), sourced to the EDR workbook with cell refs. (3) Add a matching caveat to `edr-afr-expenditures-hillsborough`. (4) Optionally confirm against the county's ACFR or the DFS LOGERX AFR, which are official sources, to tell an EDR transcription issue from a county reporting choice. **Condition: resolve before Phase 2 ships any expenditure series, and before any Phase 3 category view.** | | |
| QA-02 | P2 default view | **major** | **Interfund transfers drive the headline year-over-year moves in the planned Phase 2 default (all non-custodial funds).** Transfers are 10–39% of each year's total. FY 2021-22 revenue excluding custodial changes **−22.9%** as published, but only **−6.4%** without account 381 ($1,223M → $382M of transfers). The `Source` caveat mentions the double counting, but no control or annotation exists, so users can't see the effect. | PM, TE | **resolved** (re-verified at `f4cea65`): gross/net control in the UI and the `xfer` URL param, a methodology entry, DR-17. Default gross (O-11 open for narrower scopes) |
| | | | *Suggested fix:* add an "interfund transfers (381/581): include / exclude" methodology control (shown as a chip and in the URL), or at least an annotation. Record the default in decisions.md. Default choice belongs to the user (new open decision). | | |
| QA-03 | P1-06 Source caveats | **major** | **Known anomalies are only in docs/data-layout.md, not in `sources.json` caveats or `annotations.json`, so the UI source drawer can't show them.** (a) `2022!K8` (exp, Custodial, acct 513 Financial and Administrative) = 6,802,121. It is the only non-thousand amount in FY 2021-22, and custodial revenue that year is $6.81B, so it is probably entered in thousands. Including custodial then shows FY 2021-22 expenditures at $3.46B, between $4.31B and $10.60B. (b) FY 2020-21 and FY 2021-22 are reported rounded to $1,000 (212/212, 142/142, 211/211 and 138/139 cells). (c) Custodial revenue is booked to 311 Ad Valorem in FY 2021-22 to FY 2023-24 ($6.36B, $6.28B, $2.22B) but to 369.9 in FY 2024-25, so in include mode "ad valorem" falls by $2.2B and "miscellaneous" rises by $4.1B. (d) Hillsborough's custodial column is all zeros in FY 2020-21, so the include-mode jump appears at FY 2021-22, one year after the GASB 84 marker. | DE | **resolved** (re-verified at `f4cea65`): (a)–(d) are annotations with `custodial`/`flow` filters and expenditure/revenue Source caveats. Every cited amount matches its cell, except the refs in QA-08 |
| | | | *Suggested fix:* add (a)–(d) as caveats on the matching `Source`. Better still, add a per-observation or per-FY caveat field so the drawer shows it on tap, and add a `methodology` annotation at FY 2022 that shows only when custodial is included. Do not alter the published value. | | |
| QA-04 | P1-05 cpi.json | minor | Tampa `fiscalYearUnavailable` for FY 2005–2017 says "no data: BLS data for this series in the raw file run from 2017-11…", but official Tampa calendar-year averages exist for those years in `tampa_semiannual`. Separately, the national `alignmentRule` says "a year with any missing month is null", yet national `calendarYear["2025"]` = 321.943 (the BLS-published value, despite Oct 2025 being missing). Both are correct as data, but the wording could mislead. | DE | **resolved** (re-verified at `f4cea65`), with one nit: Tampa `calendarYearUnavailable["2017"]` still says "BLS annual average not published", though the 2017 average (219.461) is in `tampa_semiannual`. Point it there like the other years |
| | | | *Suggested fix:* point the Tampa reason to the `tampa_semiannual.calendarYear` alternative. Reword the rule to "pipeline-computed averages are never partial; BLS-published annual averages are used as published (2025 note)". | | |
| QA-05 | P1-05 population | minor | Population vintage breaks affect per-capita change at FY 2009-10 (2009 estimate 1,196,892, then 2010 census 1,229,226, +2.7%) and FY 2020-21 (2020 revised estimate 1,478,759, which is 1.3% above the 2020 census of 1,459,762, then a census-based 2021). This is documented in a Source caveat but not annotated. | DE, FE | **resolved** (re-verified at `f4cea65`): FY 2010 and FY 2021 annotations filtered to `per_capita`/`real_per_capita`. The values and FLcopops row 31 refs check out; changes of 2.7% and 0.8% are correct |
| | | | *Suggested fix:* add `methodology` annotations at FY 2010 and FY 2021, shown in per-resident modes ("Population estimate rebased to census"). | | |
| QA-06 | docs | note | plan.md P1-03 says the Tampa CPI base is "Dec 2017 = 100". The raw data and BLS metadata show 1987=100 (CY 2018 = 224.263), and DE's docs are correct. Also, the Tampa fiscal-year mean of 6 bimonthly values runs 0.06–0.29% below BLS annual averages. This is documented and caveated, and accepted. | PM | resolved by PM |
| QA-07 | P1 scope | note | "All funds" totals include pension, trust, private purpose and Component Units (legally separate, $3.5M–$12.5M a year). This is documented in caveats, so it is fine for Phase 1 validation. It needs to be visible when the Phase 3 fund-scope control lands (O-07). | PM | open |
| QA-08 | P1-06 annotations | minor | **Cross-workbook refs under a single `sourceId`.** The FY 2023 and FY 2024 transfer annotations have `sourceId: edr-afr-expenditures-hillsborough`, but `refs` include `2023!P124` and `2024!P121`. Those are the revenue 381 row totals ($536,330,405 and $775,012,474) in the **revenues** workbook. The expenditures sheets end at rows 85 and 81, so a source drawer that resolves refs against the annotation's source opens a row that doesn't exist. `data/validation.md` uses the correct revenue refs (`2023!D124`, `2024!D121`). | DE | open |
| | | | *Suggested fix:* qualify cross-workbook refs (for example `{ sourceId, ref }` objects, or a `revenues:2023!P124` prefix), or list both sourceIds. Add a validation check that every annotation ref resolves to a non-empty cell in the workbook of its source. | | |
| QA-09 | P1 data / annotations | **major** | **FY 2023-24 proprietary-fund gap has no annotation.** This is the second half of QA-01. FY 2023-24 expenditures: Enterprise $126M vs $543M (FY 2022-23) and $666M (FY 2024-25); 536 Water-Sewer $0 in Enterprise (`2024!I29`) vs $235M and $239M; Internal Service 519 $18.9M (`2024!J14`) vs $232M and $243M; Component Units $0. Enterprise plus Internal Service are about $650M below FY 2022-23, which accounts for most of the physical_environment change (−67.9%, then +309.2%; flagged in the validation YoY table but not annotated). QA checked the county-filed AFR (`afr-fy2024.pdf`): Water/Sewer Combination Services shows only $1,858 operating, and 519 Internal Service shows $18,872,025. So this too is as the county filed it. Today's FY 2024 annotation names only 581/381, 521 and public safety, so a physical-environment or total-expenditure chart shows the drop with no context. | DE, PM (O-10 wording) | open |
| | | | *Suggested fix:* extend the FY 2024 annotation, or add a second one, to state the Enterprise, Internal Service and Component Unit amounts against adjacent years and the county-AFR page. Add those PDF lines to `county-afr-checks.ts`. Consider fund-level YoY rows in validation (R-07). **Condition: before Phase 2 ships expenditure views to users.** | | |
| QA-10 | P1 sources | note | The FY 2024-25 county AFR (`afr-fy2025.pdf`) header reads `AUDIT RECEIVED DATE: unresolved: @afr.auditreceiveddate`, an unfilled template placeholder. The FY 2022–2024 filings show real audit dates. The FY 2024-25 figures may predate the audit. The EDR workbook doesn't say either way. | DE | open |
| | | | *Suggested fix:* add a caveat to the FY 2025 county-AFR Source and consider a FY 2025 `methodology` note ("audit receipt date not shown in the filed AFR"). Re-check when EDR or DFS update. | | |
