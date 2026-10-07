# Task Board: Phases 1–2

Branch: `feature/phase-1-2`. Scope this round: Phase 1 (data pipeline) and Phase 2 (MVP explorer). Then stop for user review.
Related: [decisions.md](decisions.md) · [risks.md](risks.md) · [data-layout.md](data-layout.md) (data engineer owns it)

Status values: `todo` · `in-progress` · `review` (waiting on QA) · `done` · `blocked`

Owners: **DE** data engineer · **FE** frontend engineer · **TE** transform engineer · **QA** QA/skeptic · **PM** project manager

---

## Phase 1: Data pipeline

| ID | Task | Owner | Depends on | Status |
|---|---|---|---|---|
| P1-01 | Inspect EDR xlsx structure, document in `docs/data-layout.md` | DE | none | done |
| P1-02 | Set up `data/raw/` and source manifest | DE | none | done |
| P1-03 | Fetch population (EDR) and CPI (BLS CPI-U + Tampa) raw files | DE | P1-02 | done |
| P1-04 | Parse revenue/expenditure xlsx to `Observation[]` | DE | P1-01, P1-02 | done |
| P1-05 | Population and CPI series to year-keyed JSON | DE | P1-03 | done |
| P1-06 | Emit versioned `src/assets/data/*.json` + `Source` records | DE | P1-04, P1-05 | done |
| P1-07 | Validation report `data/validation.md` | DE | P1-06 | done |
| P1-08 | Pipeline unit tests | DE | P1-04 | done |
| P1-09 | QA review of Phase 1 (hand re-derivation) | QA | P1-07 | done |

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
- [x] All P1 tasks `done`. P1-09 has no open blocker findings.
- [x] `npm run pipeline` is green and deterministic (checksums stable across 2 runs).
- [x] `data/validation.md` is all-pass (or each exception is allowlisted with a reason).
- [x] Every emitted number traces to publisher, file, account code, fiscal year, and retrieval date.
- [x] `docs/data-layout.md` is complete. decisions.md is updated with any choices made during parsing.

**Phase 1 approved by QA** (2026-10-06, tag `phase-1-approved`). Deferred: QA-07 (all-funds scope includes pension, trust and component units) moves to Phase 3 under O-07.

---

## Phase 2: MVP explorer

| ID | Task | Owner | Depends on | Status |
|---|---|---|---|---|
| P2-01 | Upgrade Angular 17.3 to latest (stepwise `ng update`), CLI-default test runner | FE | none | done |
| P2-02 | Add `ngx-echarts` + Angular Material; theme tokens, light/dark | FE | P2-01 | done |
| P2-03 | `src/app/core/models.ts` (Observation, Source, Annotation) | TE | P1-01 | done |
| P2-04 | Pure `transform.ts` + exhaustive tests | TE | P2-03, P1-05 | done |
| P2-05 | Data loading service (static JSON, checksum check) | FE | P1-06, P2-01 | in-progress |
| P2-06 | URL-state service (query params ↔ signals) | FE | P2-01 | in-progress |
| P2-07 | Controls: measure, base year, range, custodial, inflation index | FE | P2-06 | done |
| P2-08 | Line chart with GASB 84 annotation, range slider, pinch-zoom | FE | P2-02, P2-04, P2-05 | in-progress |
| P2-09 | View-as-table toggle | FE | P2-08 | done |
| P2-10 | Mobile-first layout, chip row, bottom sheet | FE | P2-07 | done |
| P2-11 | Minimal source/provenance display | FE | P2-05 | done |
| P2-12 | QA review of Phase 2 | QA | P2-04..P2-11, P2-13, P2-14, P2-15 | in-progress |
| P2-13 | Apply theme D "BI dashboard" (decisions D-07) | FE | P2-02 | done |
| P2-14 | Deployable static build: GitHub Pages sub-path and IIS (decisions D-12) | FE | P2-05 | todo |
| P2-15 | Skeleton loaders (user request) | FE | P2-14 | todo |

Phase 2 status notes (QA review `5a4afb2`: approve with conditions):
- **Conditions to close Phase 2:** QA-11 (chart zoom not in view state, P2-08) and QA-12 (Back/forward, P2-06).
- **Re-verified by QA (`23ed862`):** QA-13 (axis label contrast), QA-16 (manual theme toggle) and QA-18 (KPI test) are resolved. P2-02 and P2-13 are done.
- **Open minors:** QA-14 (no data-version/checksum check, P2-05), QA-19 (user-facing notes expose internal paths), QA-20 (Export/Share messages on touch). QA-22 is a note.
- **Resolved by decision:** QA-17, by DR-32 (URL writes every setting).
- **Deferred:** QA-15 (tablet side panel) to Phase 6 polish. QA-21 (chart self-description when cropped) to Phase 5, where the PNG export must print the settings. See DR-33.

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
- [ ] Invalid or out-of-range params fall back to defaults and do not crash. Every setting is written to the URL, including defaults, so a shared link keeps its meaning if defaults change. Unknown params are preserved. (Amended by decisions DR-32, resolving QA-17.)
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
- [ ] Tablet: collapsible side panel (deferred to Phase 6, QA-15 / DR-33). Desktop: persistent filters pane on the **right** (user decision D-07 overrides CLAUDE.md's "left").
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
- [ ] IBM Plex Sans and IBM Plex Mono are self-hosted (bundled from `@fontsource`), with no third-party requests. The network tab shows no requests to Google Fonts or any other third-party font host.

**P2-14 Deployable static build**
- [ ] The base href is configurable at build time (for example `ng build --base-href /<repo>/` for a GitHub Pages sub-path, `/` or a virtual directory for IIS). The app, deep links and query-param URLs work under each.
- [ ] Data files (`assets/data/*.json`) and fonts load relative to the base href. There are no root-absolute `/assets/...` paths, and nothing 404s under a sub-path (checked in the network tab).
- [ ] IIS `web.config` is shipped in the build output. It includes:
  - MIME types for `.json` and `.woff2`;
  - a URL Rewrite rule that sends non-file routes to `index.html`;
  - long-lived immutable caching for hashed bundles;
  - `no-cache` (revalidate) for `index.html` and the data JSON/manifest, so a data refresh is seen right away.
- [ ] GitHub Pages: the build output contains `404.html` (a copy of or redirect to `index.html` so deep links work) and `.nojekyll`.
- [ ] `docs/deploy.md` gives step-by-step instructions for both hosts: build command with base href, files to copy, IIS prerequisites (URL Rewrite module), GitHub Pages settings, and how to verify a deploy (load a shared URL, check data checksums/version).
- [ ] A shared URL with query params opened on each host reproduces the same view (same check as P2-06).

**P2-15 Skeleton loaders**
- [ ] Load waits are measured on a throttled mobile profile (for example DevTools "Slow 4G" + 4× CPU slowdown), before and after. The results (time to first data, ECharts chunk ready) are recorded in the task notes or `docs/`.
- [ ] Skeletons replace the progress bar for: KPI cards, the chart tile, the Notes and Sources tiles, and the phone chip row.
- [ ] No layout shift on load. Skeletons match final dimensions. CLS ≈ 0, measured with a Lighthouse/Performance trace on the throttled profile.
- [ ] Skeletons appear only after a ~150–200 ms delay, so fast loads show no flash.
- [ ] The chart skeleton stays until the lazy ECharts chunk is loaded and the first render is done. It is never replaced by an empty chart.
- [ ] Accessibility:
  - the loading region has `aria-busy="true"`;
  - exactly one polite live-region message is announced per load;
  - skeleton shapes are `aria-hidden`.
- [ ] Under `prefers-reduced-motion: reduce`, skeletons are static, with no shimmer or pulse.
- [ ] Skeleton colors come from the design tokens only and work in light and dark (meeting the contrast rules for non-text UI where they apply).
- [ ] Error, Retry and schema/version-error states take precedence over skeletons. A failed load never leaves a skeleton showing.
- [ ] QA verifies all of the above under P2-12.

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
- [ ] A production build works under a sub-path base href and on IIS, per `docs/deploy.md` (P2-14).
- [ ] The PM end-of-round summary is written, with open decisions re-raised to the user.

---

## Later phases: priority notes

- **Phase 5, high priority (decisions D-12, public site):** the methodology page and the "how to reproduce" page come first in Phase 5, ahead of claim presets and CSV/PNG export. They must cover:
  - every methodology control and its default;
  - the custodial / GASB 84 caveat;
  - transfers gross vs net;
  - CPI index × period;
  - population basis;
  - known source anomalies (QA-01/QA-03);
  - how to run `npm run fetch` / `npm run pipeline` and verify the checksums.
- Phase 5 also carries QA-21 (the PNG export prints settings and sources) (DR-33).
- Phase 6 carries QA-15 (tablet collapsible side panel) (DR-33).
- **Phase 3:** any new long-running operation (category breakdowns, a second dataset such as expenditures alongside revenues) reuses the P2-15 skeleton components and follows the same rules: delay, no layout shift, a11y, reduced motion, errors take precedence. No new loader styles.
- Phase 4 is on hold (D-11).

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

**Close-out at `26bf54c` (2026-10-06):** independent checker 0 FAIL. Fresh `autocrlf=true` clone: 41 tests pass, and two `npm run pipeline` runs give no diff against the committed outputs. Gap scan (DR-25) re-implemented independently in Python: 20 drop years, which become the pipeline's 19 episodes once consecutive years are merged (revenue miscellaneous FY 2020-21 and FY 2021-22 are one episode). Every before/during/after value matches. 6 are annotated (FY 2024 Enterprise, Internal Service, Component Units and physical environment; FY 2023-24 court-related and public safety, inside the transfer-imbalance annotations) and 13 are listed for reference, as DR-29 states. All 21 annotations carry a known `topic`; validation fails on a missing or unknown one. Neutrality grep of annotations: clean (the single "only" is a factual statement about rounding).

| ID | Phase/Task | Severity (blocker/major/minor) | Finding | Owner | Status |
|---|---|---|---|---|---|
| QA-01 | P1 data / P2–P3 display | **major** | **Source-classification break in FY 2022-23 and FY 2023-24 expenditures. Nothing in the data surfaces it.** Revenue 381 (transfers in) equals expenditure 581 (transfers out) within $601 in 19 of 21 years. In FY 2022-23, 581 exceeds 381 by **$624,603,841**. In FY 2023-24 it exceeds it by **$535,878,141**. In the same two years: account 521 Law Enforcement is $0.6M and $9.0M (`2023!D16`=203,849, `2024!D16`=150,746), against $511M in FY 2021-22 and $716M in FY 2024-25 (`2025!D16`=680,677,907). General Fund 581 is $787M and $912M (`2023!D57`, `2024!D57`), against $121M and $341M in the years either side. The public_safety section (non-custodial) is $387M and $368M, against $883M and $1,300M. FY 2023-24 also has Enterprise 536 Water-Sewer at $0 (`2024!I29`; $235M in FY 2022-23, $239M in FY 2024-25), Internal Service 519 at $18.9M (`2024!J14`; $232M and $243M either side), and Component Units at $0. Headline effect: total expenditures excluding custodial change −12.6% (FY 2023-24), then +47.7% (FY 2024-25). The pipeline transcribes the workbook correctly. The problem is that a chart would show "law enforcement spending fell 99%" or "public safety tripled" with no annotation. | DE (detect), PM (decide wording) | **resolved** (close-out at `26bf54c`): transfer-imbalance annotations now also name the public safety and court-related sections with FY 2021-22 and FY 2024-25 comparisons (DR-29). The proprietary-fund half is closed under QA-09. |
| | | | *Suggested fix:* (1) Add validation NOTE checks for 381 vs 581 imbalance and for large YoY swings by section and fund, so future refreshes flag these automatically (R-07/R-08). (2) Emit `Annotation`s at FY 2023 and FY 2024 (kind `methodology`, neutral wording such as "Reporting classification differs from adjacent years: transfers out exceed transfers in by $X; see source caveats"), sourced to the EDR workbook with cell refs. (3) Add a matching caveat to `edr-afr-expenditures-hillsborough`. (4) Optionally confirm against the county's ACFR or the DFS LOGERX AFR, which are official sources, to tell an EDR transcription issue from a county reporting choice. **Condition: resolve before Phase 2 ships any expenditure series, and before any Phase 3 category view.** | | |
| QA-02 | P2 default view | **major** | **Interfund transfers drive the headline year-over-year moves in the planned Phase 2 default (all non-custodial funds).** Transfers are 10–39% of each year's total. FY 2021-22 revenue excluding custodial changes **−22.9%** as published, but only **−6.4%** without account 381 ($1,223M → $382M of transfers). The `Source` caveat mentions the double counting, but no control or annotation exists, so users can't see the effect. | PM, TE | **resolved** (re-verified at `f4cea65`): gross/net control in the UI and the `xfer` URL param, a methodology entry, DR-17. Default gross (O-11 open for narrower scopes) |
| | | | *Suggested fix:* add an "interfund transfers (381/581): include / exclude" methodology control (shown as a chip and in the URL), or at least an annotation. Record the default in decisions.md. Default choice belongs to the user (new open decision). | | |
| QA-03 | P1-06 Source caveats | **major** | **Known anomalies are only in docs/data-layout.md, not in `sources.json` caveats or `annotations.json`, so the UI source drawer can't show them.** (a) `2022!K8` (exp, Custodial, acct 513 Financial and Administrative) = 6,802,121. It is the only non-thousand amount in FY 2021-22, and custodial revenue that year is $6.81B, so it is probably entered in thousands. Including custodial then shows FY 2021-22 expenditures at $3.46B, between $4.31B and $10.60B. (b) FY 2020-21 and FY 2021-22 are reported rounded to $1,000 (212/212, 142/142, 211/211 and 138/139 cells). (c) Custodial revenue is booked to 311 Ad Valorem in FY 2021-22 to FY 2023-24 ($6.36B, $6.28B, $2.22B) but to 369.9 in FY 2024-25, so in include mode "ad valorem" falls by $2.2B and "miscellaneous" rises by $4.1B. (d) Hillsborough's custodial column is all zeros in FY 2020-21, so the include-mode jump appears at FY 2021-22, one year after the GASB 84 marker. | DE | **resolved** (re-verified at `f4cea65`): (a)–(d) are annotations with `custodial`/`flow` filters and expenditure/revenue Source caveats. Every cited amount matches its cell, except the refs in QA-08 |
| | | | *Suggested fix:* add (a)–(d) as caveats on the matching `Source`. Better still, add a per-observation or per-FY caveat field so the drawer shows it on tap, and add a `methodology` annotation at FY 2022 that shows only when custodial is included. Do not alter the published value. | | |
| QA-04 | P1-05 cpi.json | minor | Tampa `fiscalYearUnavailable` for FY 2005–2017 says "no data: BLS data for this series in the raw file run from 2017-11…", but official Tampa calendar-year averages exist for those years in `tampa_semiannual`. Separately, the national `alignmentRule` says "a year with any missing month is null", yet national `calendarYear["2025"]` = 321.943 (the BLS-published value, despite Oct 2025 being missing). Both are correct as data, but the wording could mislead. | DE | **resolved** (close-out at `26bf54c`): the Tampa 2017 reason now says "not published for this series" and points to `tampa_semiannual.calendarYear`. |
| | | | *Suggested fix:* point the Tampa reason to the `tampa_semiannual.calendarYear` alternative. Reword the rule to "pipeline-computed averages are never partial; BLS-published annual averages are used as published (2025 note)". | | |
| QA-05 | P1-05 population | minor | Population vintage breaks affect per-capita change at FY 2009-10 (2009 estimate 1,196,892, then 2010 census 1,229,226, +2.7%) and FY 2020-21 (2020 revised estimate 1,478,759, which is 1.3% above the 2020 census of 1,459,762, then a census-based 2021). This is documented in a Source caveat but not annotated. | DE, FE | **resolved** (re-verified at `f4cea65`): FY 2010 and FY 2021 annotations filtered to `per_capita`/`real_per_capita`. The values and FLcopops row 31 refs check out; changes of 2.7% and 0.8% are correct |
| | | | *Suggested fix:* add `methodology` annotations at FY 2010 and FY 2021, shown in per-resident modes ("Population estimate rebased to census"). | | |
| QA-06 | docs | note | plan.md P1-03 says the Tampa CPI base is "Dec 2017 = 100". The raw data and BLS metadata show 1987=100 (CY 2018 = 224.263), and DE's docs are correct. Also, the Tampa fiscal-year mean of 6 bimonthly values runs 0.06–0.29% below BLS annual averages. This is documented and caveated, and accepted. | PM | resolved by PM |
| QA-07 | P1 scope | note | "All funds" totals include pension, trust, private purpose and Component Units (legally separate, $3.5M–$12.5M a year). This is documented in caveats, so it is fine for Phase 1 validation. It needs to be visible when the Phase 3 fund-scope control lands (O-07). | PM | deferred to Phase 3 (fund-scope control, O-07); not a Phase 1 condition |
| QA-08 | P1-06 annotations | minor | **Cross-workbook refs under a single `sourceId`.** The FY 2023 and FY 2024 transfer annotations have `sourceId: edr-afr-expenditures-hillsborough`, but `refs` include `2023!P124` and `2024!P121`. Those are the revenue 381 row totals ($536,330,405 and $775,012,474) in the **revenues** workbook. The expenditures sheets end at rows 85 and 81, so a source drawer that resolves refs against the annotation's source opens a row that doesn't exist. `data/validation.md` uses the correct revenue refs (`2023!D124`, `2024!D121`). | DE | **resolved** (close-out at `26bf54c`): refs are workbook-qualified (DR-24), e.g. `revenues:2023!P124`. A validation check requires each to resolve. QA resolved all 44 refs with its own reader, and every amount cited in the details equals its cell. |
| | | | *Suggested fix:* qualify cross-workbook refs (for example `{ sourceId, ref }` objects, or a `revenues:2023!P124` prefix), or list both sourceIds. Add a validation check that every annotation ref resolves to a non-empty cell in the workbook of its source. | | |
| QA-09 | P1 data / annotations | **major** | **FY 2023-24 proprietary-fund gap has no annotation.** This is the second half of QA-01. FY 2023-24 expenditures: Enterprise $126M vs $543M (FY 2022-23) and $666M (FY 2024-25); 536 Water-Sewer $0 in Enterprise (`2024!I29`) vs $235M and $239M; Internal Service 519 $18.9M (`2024!J14`) vs $232M and $243M; Component Units $0. Enterprise plus Internal Service are about $650M below FY 2022-23, which accounts for most of the physical_environment change (−67.9%, then +309.2%; flagged in the validation YoY table but not annotated). QA checked the county-filed AFR (`afr-fy2024.pdf`): Water/Sewer Combination Services shows only $1,858 operating, and 519 Internal Service shows $18,872,025. So this too is as the county filed it. Today's FY 2024 annotation names only 581/381, 521 and public safety, so a physical-environment or total-expenditure chart shows the drop with no context. | DE, PM (O-10 wording) | **resolved** (close-out at `26bf54c`): `proprietary-fund-gap` annotation at FY 2024 (DR-26/29) lists Enterprise, Internal Service, Component Units and physical environment, with the accounts behind each drop (534, 536, 519, 515, 559) and adjacent-year values. QA checked all values. The 5 new county-AFR lines tie out: Enterprise total $126,477,435 and Internal Service $18,872,025 (p. 16) equal the EDR fund sums; 519 $18,872,025 equals `2024!J14`; 533 $94,926,041 − $2,245,626 = $92,680,415 equals `2024!I26`; no 536 Enterprise line, matching `2024!I29` = 0. **Correction to QA's earlier text:** the $1,858 line is account 535 Sewer/Wastewater Services, General Fund (`2024!D28`), confirmed by `pdftotext -raw` on p. 9. The 536 General lines are $48,181 + $14,068 + $21,046 = $83,295 = `2024!D29`. QA's `-layout` reading had misaligned the label. |
| | | | *Suggested fix:* extend the FY 2024 annotation, or add a second one, to state the Enterprise, Internal Service and Component Unit amounts against adjacent years and the county-AFR page. Add those PDF lines to `county-afr-checks.ts`. Consider fund-level YoY rows in validation (R-07). **Condition: before Phase 2 ships expenditure views to users.** | | |
| QA-10 | P1 sources | note | The FY 2024-25 county AFR (`afr-fy2025.pdf`) header reads `AUDIT RECEIVED DATE: unresolved: @afr.auditreceiveddate`, an unfilled template placeholder. The FY 2022–2024 filings show real audit dates. The FY 2024-25 figures may predate the audit. The EDR workbook doesn't say either way. | DE | **resolved** (close-out at `26bf54c`): caveat on `county-afr-hillsborough-fy2025` quotes the placeholder and gives the prior years' audit dates (DR-27). |
| | | | *Suggested fix:* add a caveat to the FY 2025 county-AFR Source and consider a FY 2025 `methodology` note ("audit receipt date not shown in the filed AFR"). Re-check when EDR or DFS update. | | |

### P2-12 Phase 2 review (2026-10-06, committed HEAD `b01c40a`)

Method: production build (`ng build`) served statically from a clean clone of `b01c40a`, driven in headless Chrome through the DevTools protocol (scripts in `qa/phase2/`: `probe.mjs`, `history.mjs`, `sheet.mjs`, `contrast.mjs`, `canvas-colors.mjs`, `tooltip.mjs`, `wheel.mjs`, `zoom.mjs`, `pinch.mjs`, `fail-load.mjs`, `text-sweep.mjs`). `ng test`: 207 tests pass. `transform.ts` 166/166 statements, 163/163 branches; `kpi.ts` and `fiscal-year.ts` 100%. The uncommitted FE edits present during review (color-scheme override, workbook-grouped citations) were **not** reviewed.

**Verified with no defects found:**
- **15 on-screen values re-derived from the raw files** (workbook cells read with QA's stdlib reader, FLcopops population, BLS monthly, bimonthly and semiannual values), all exact. Table: rev nominal FY 2024-25 $5,468,332,134; rev per resident FY 2005-06 $2,683.25 and FY 2024-25 $3,470.55; rev real (U.S. fiscal, base FY 2019-20) FY 2005-06 $4,018,034,514 and FY 2024-25 $4,409,123,358; rev real per resident (Tampa fiscal, base FY 2024-25) FY 2017-18 $3,308.15; rev real (Tampa calendar, base FY 2019-20) FY 2005-06 $4,170,276,855; index FY 2005-06=100, FY 2009-10 93.1; exp incl. custodial FY 2024-25 $9,035,938,484. KPI: change +75.0%; custodial card $4.13B. Tooltip: exp real per resident (base FY 2019-20) FY 2022-23 $2,110.17, FY 2020-21 $2,795.73, FY 2004-05 $3,222.37; rev Tampa real FY 2023-24 $4,807,404,495.
- **Gaps:** Tampa fiscal-year mode leaves FY 2005-06 to FY 2016-17 as a true break in the line (`connectNulls: false`), never spliced. A base year inside the gap makes every value "—" with a reason, and the KPI change reads "not computable".
- **URL:** two fresh tabs opened from the same non-default URL give identical controls, KPIs and caption, and the URL is not rewritten. Bad params (`flow=foo`, `base=1900`, `from=2030&to=1990`, `cust=2`, `cpi=zzz` …) fall back per key with no console errors. A reversed range is swapped.
- **Custodial and GASB 84:** custodial is excluded by default. The GASB 84 marker appears in every range that includes FY 2020-21, in both custodial modes and all measures.
- **Annotation filters on screen:** population notes appear only in per-resident measures. Custodial-account notes appear only with custodial included. The transfer imbalance appears **once per surface**: chart lines and "Notes for this view" use the annotation (expenditure), while the tooltip and table use the point note.
- **KPI neutrality (D-07):** the cards show only the user's range end, range start, the change between them, and custodial for the end year. Accent color and value color are the same whatever the sign. A rendered-text sweep of 4 views × desktop/phone (including expanded caveats, every bottom sheet, and aria/title text) found **0** loaded or editorial words. There are no advocacy sources.
- **Provenance:** the source line under the chart names the AFR workbook. "Settings and sources" lists exactly the sources the view uses: BLS Tampa semiannual and EDR population appear only in Tampa per-resident views.
- **Accessibility:**
  - Phone bottom sheets: all controls ≥ 44 px, focus moves into the sheet, Escape closes it and returns focus to the chip.
  - Desktop: Tab order is logical and every stop has a 2 px focus ring (3:1 or better in both themes).
  - DOM text contrast ≥ 5.59:1 in light and dark at desktop and phone.
  - The table has a caption and `th scope`. The chart `aria-label` points to the table.
- **Layout:** 360, 390 and 820 px have no horizontal page scroll. The only sub-44 px target at phone width is a 314×40 link.
- **Network:** only same-origin requests; IBM Plex is self-hosted. A missing data file shows a clear error with Retry, never an empty chart.

**Delta re-check at `0c67b47` (FE follow-ups; 212 tests pass, clean build):** QA-13, QA-16 and QA-18 are resolved (statuses below). Workbook-qualified refs: "Notes for this view" now groups cells by workbook and links each group to its own source (e.g. `2023!P124` → revenues workbook, `2023!P57` → expenditures workbook, population cells → FLcopops.xlsx). Transfer de-duplication (topic-based): the imbalance appears once per surface in the notes list, table rows and tooltip, for both flows. Fonts: woff2 files are bundled from `@fontsource` into the build output, and only same-origin requests were seen. QA accepts this as "self-hosted"; P2-13's "from `src/assets`" wording should be amended to match. Not in this delta and still open: **QA-11 and QA-12 (major)**, and QA-14, QA-15, QA-17, QA-19 to QA-22. New since the review: CLAUDE.md now requires sub-path base href and IIS hosting. Not yet tested, to be checked at the next round.

| ID | Phase/Task | Severity (blocker/major/minor) | Finding | Owner | Status |
|---|---|---|---|---|---|
| QA-11 | P2-08 chart zoom | **major** | **Chart zoom is not part of the view state, so the chart can disagree with every number around it.** The ECharts `inside` dataZoom captures the mouse wheel and pinch. Desktop: 8 wheel-ups zoom the chart to FY 2013-14 to FY 2022-23, while the KPIs still read "FY 2005-06 → FY 2024-25 · +75.0%", the range readout says FY 2005-06 – FY 2024-25, and the URL is unchanged (`qa/phase2/zoom.mjs`). Phone: a pinch zooms the chart to FY 2013-14 to FY 2015-16, with the readout directly under it still saying FY 2005-06 – FY 2024-25 (`pinch.mjs`). A shared link doesn't reproduce the view, and a screenshot pairs a chart window with headline numbers for other years. There is no reset-zoom control. Wheel-down over the chart also traps desktop page scrolling: scrollY stays 0, against 240 px elsewhere (`wheel.mjs`). | FE | **resolved** (re-verified at `06821ea`): a phone pinch settles into a range change. Chart window FY 2012-13 to FY 2017-18 = readout = chip = KPIs (+29.8%, hand-checked) = URL `from=2013&to=2018`, and one Back restores the full range (`pinch2.mjs`). The wheel no longer zooms and scrolls the page (`wheel.mjs`, `zoom.mjs`). KPI neutrality holds: the KPIs follow the range the user's own gesture sets, and the chart redraws to exactly that range. |
| | | | *Suggested fix:* make zoom set the range. On `datazoom`, map the visible window to fiscal years and call `store.update({ range })`, so KPIs, chips, readout and URL follow. Otherwise remove the inside zoom and rely on the range control (pinch-to-range). Set `zoomOnMouseWheel: false` (or require a modifier key) so page scrolling works. **Condition for Phase 2 done.** | | |
| QA-12 | P2-06 URL state | **major** | **Back/forward does not restore earlier views.** Every `navigate` in `explorer-store.ts` uses `replaceUrl: true`, including user changes. After two setting changes `history.length` is still 2, and Back leaves the app (the tab goes to `about:blank`). P2-06 requires "Back/forward navigation restores the previous states." | FE | **resolved** (re-verified at `06821ea`): user changes push history entries and canonicalizing replaces. Back and Forward restore the URL, controls and KPIs (`history.mjs`). See QA-23 for desktop slider drags. |
| | | | *Suggested fix:* use `replaceUrl: true` only for the canonicalizing effect (filling in or normalizing params). Push a history entry for user-initiated `update()`/`reset()`, debounced for slider drags. Add a test. **Condition for Phase 2 done.** | | |
| QA-13 | P2-02 / P2-13 contrast | **major** | **Chart axis labels fail WCAG AA.** The canvas axis labels (fiscal years and $ ticks, 10 px) use `--fx-color-text-faint`: **2.99:1** on the light tile (rgb 140,150,165 on white) and **4.40:1** on the dark tile (rgb 125,134,150 on rgb 29,33,41). AA needs 4.5:1. The dashed annotation lines, including the GASB 84 marker, use the same token in light: 2.99:1, under the 3:1 minimum for graphics (`canvas-colors.mjs`). All DOM text passes. | FE | **resolved** (re-verified at `0c67b47`): canvas axis labels are 4.66:1 light and 5.55:1 dark; annotation lines are 3.67:1 and 4.40:1. The DOM scan finds 0 failures in either theme at desktop and phone. |
| | | | *Suggested fix:* use `--fx-color-text-muted` for axis labels (5.97:1 light, 6.34:1 dark) and darken `--fx-annotation-methodology` in light to at least 3:1. **Condition for Phase 2 done.** | | |
| QA-14 | P2-05 data loading | minor | No data-version or checksum check. Serving a manifest with `schemaVersion: 99` renders normally (`fail-load.mjs`), and the manifest's sha256 values are never checked. P2-05: "A data version mismatch … shows a clear error state". The missing-file case works. | FE | **resolved** (re-verified at `06821ea`): a manifest with `schemaVersion: 99` shows a plain-language error with Retry and no chart (`fail-load.mjs`). sha256 is not checked; QA accepts that. |
| | | | *Suggested fix:* compare `manifest.schemaVersion` with a constant the app was built for and show the error state on mismatch. Optionally verify sha256 with `crypto.subtle` (cheap; about 1.9 MB of JSON). | | |
| QA-15 | P2-10 tablet | minor | Tablet (820 px) uses the phone chip-and-sheet pattern; there is no collapsible side panel. `explorer.component.scss` has only a desktop breakpoint. It is usable, but it differs from P2-10. Methodology/source links in the notes are 15 px tall at tablet width with touch. | FE, PM | **deferred** to Phase 6 by DR-33. |
| | | | *Suggested fix:* add the tablet panel, or record a decision accepting the chip/sheet pattern at tablet width. Give note and source links a ≥ 44 px hit area on touch. | | |
| QA-16 | P2-02 theme | minor | No manual light/dark override at `b01c40a`; the theme only follows `prefers-color-scheme`. P2-02 requires a manual override. An uncommitted FE change (`color-scheme.service.ts`) adds one; QA will verify it once committed. | FE | **resolved** (re-verified at `0c67b47`): Auto/Light/Dark header button (44 px on phone, accessible name "Color theme: X. Change"). It cycles correctly, persists across reload, overrides the system setting in both directions, and the canvas chart re-themes. |
| QA-17 | P2-06 URL | minor | The URL always writes all 10 params, including defaults, which conflicts with P2-06 "defaults are not written to the URL unnecessarily". The code comment gives a reason (a link keeps its meaning if defaults change), but no decision records it. `queryParamsHandling: 'merge'` also keeps unknown params (`extra=1`). | FE, PM | **resolved** by DR-32 (full-param URLs are the decided behavior; P2-06 amended). |
| | | | *Suggested fix:* record the full-param choice as a decision (it is arguably better for reproducibility) and amend P2-06, or drop defaults. Drop unknown params. | | |
| QA-18 | P2-13 KPI test | minor | P2-13 asks for "a test asserts that KPI values equal `transform.ts` outputs for the current settings". `kpi.spec.ts` uses hand-made points, not `buildSeries` output on real data. QA confirmed the live values match. | FE | **resolved** (re-verified at `0c67b47`): `kpi.spec.ts` runs `buildSeries` for 3 settings and asserts that every card's `raw` equals the transform output, plus a hand-computed real-per-resident case. Fixture data, not the committed JSON, which meets the criterion. |
| | | | *Suggested fix:* add a spec that runs `buildSeries` on the committed JSON for 2–3 settings and asserts that the KPI end/start/change strings equal the formatted first/last points. | | |
| QA-19 | P2 copy | minor | Point notes shown to users expose internal paths and jargon: Tampa gap reasons end "…is in cpi.json tampa_semiannual.calendarYear". When the base year falls in a Tampa gap, every row says "No CPI-U … for FY 2009-10" without saying it is the **base** year. In net mode and Tampa views, "By year" repeats a near-identical sentence for every year (21 and 12 lines). | FE, DE | **resolved** (re-verified at `06821ea` + `37048fb`): no file names or field paths on the page. Tampa gap notes are grouped into year ranges and point to the calendar-year option. The base-year reason says "for base year FY 2009-10". Public BLS series IDs remain, which is fine. The Phase 1 checker is still 0 FAIL on the regenerated data. |
| | | | *Suggested fix:* map reasons to plain language ("Tampa calendar-year averages are available under CPI period"). Prefix base-year reasons with "Base year". Group notes that differ only by year or amount. | | |
| QA-20 | P2 a11y | minor | The disabled Export button explains itself only through `title` (not shown on touch, inconsistently announced). When copying fails, Share shows "Copy failed" and the URL only in a screen-reader live region, so sighted users get no link. | FE | **resolved** (re-verified at `06821ea`): Export shows a visible "Not available yet". When copying fails, Share shows "Copy failed. The link is shown below." and a visible text field holding the full URL. |
| QA-21 | P2-07 / P2-08 self-description | minor | When the chart tile is screenshotted or cropped, it doesn't carry all methodology. In inflation-adjusted modes the caption reads "FY 2024-25 dollars" with no CPI index or period, and desktop hides the chips (the filters pane shows them). R-03 says the index is "always shown in a chip and the axis label". The phone header and visible title don't name the jurisdiction ("Hillsborough County" is screen-reader-only in the title). This matters for Phase 5 PNG export. | FE | **deferred** to Phase 5 (PNG export) by DR-33. |
| | | | *Suggested fix:* add the CPI index and period to the caption when real, and show the jurisdiction in the visible title on phone. | | |
| QA-22 | P2-08 / P2-10 phone polish | note | At 390 px the chip row is clipped at the right edge with no scroll cue. Annotation labels at FY 2020-21 to FY 2023-24 crowd ("Note 3", "Note 4", "Notes 5, 6" next to the GASB label). P2-08's "dataZoom slider" is implemented as a range slider (fine once QA-11 ties zoom to the range). | FE | **resolved** (re-verified at `06821ea`): the phone chip row fades at the edge (scroll cue). Annotation lines on phone carry note numbers only ("1, 2", "3", "4", "5, 6") with no crowding. |
| QA-23 | P2-06 history | minor | On desktop, one mouse drag of a range-slider thumb adds **two** history entries: the press itself moves the range one step (FY 2005-06 → FY 2006-07), then the release sets the final range. The first Back lands on a range the user never chose. On phone, a touch drag adds one entry (`slider-drag.mjs`). Synthetic input may overstate this. | FE | **resolved** (re-verified at `a9f86d6`): the slider commits on drag end. `slider-drag.mjs`, run twice: one drag = 1 history entry on desktop (mouse) and phone (touch), and one Back restores the previous range. Keyboard still works (`slider-keys.mjs`): each arrow key moves a thumb one year and adds one entry, and the URL follows. |
| | | | *Suggested fix:* commit the range on the slider's drag end only (`dragEnd`), or replace (not push) when consecutive updates arrive within the debounce window. | | |

**P2-12 re-check at `06821ea` (2026-10-06):** clean clone, 231 tests pass, production build driven in headless Chrome. QA-11, QA-12, QA-14, QA-19, QA-20 and QA-22 are resolved (statuses above). QA-17 is closed by DR-32, and QA-15 and QA-21 are deferred by DR-33. **No open major findings remain in Phase 2.** Open minors: QA-23. Still to check: sub-path base href and IIS (CLAUDE.md) with P2-14 deploy.

**P2-14 deploy review (2026-10-06, `bbf08cd`):** `npm run build:pages` in a clean clone writes `<base href="/HCAnalyzer-UI/">`, relative bundle/font/data URLs, `404.html` (copy of `index.html`), `.nojekyll` and `web.config`. Served by `qa/phase2/pages-server.mjs` (GitHub Pages behavior: sub-path only, a 301 adds the trailing slash, unknown paths → `404.html` with status 404) and driven in headless Chrome (`qa/phase2/subpath.mjs`):
- Every case loads the app with the expected KPI and no console errors: entry with and without the trailing slash; a shared link with params; deep paths with and without params; a mistyped file; explicit `index.html`. Query params survive the 404 fallback and the router redirect.
- Changing a setting and then reloading restores the view exactly (URL, control, KPI).
- All 33 asset requests (bundles, `media/*.woff2` via `./media/` URLs, `assets/data/*.json`) stayed under `/HCAnalyzer-UI/`. No request went outside the sub-path or to a third party.
- `web.config` (static review; IIS not installed here): well-formed. The MIME remove-then-add pattern, the SPA fallback (`IsFile`/`IsDirectory` negated, so the default document still serves `/`), app-relative `location` paths (they work in a sub-path application), DisableCache for `index.html`, `404.html` and `assets/data`, and long-cache `public, immutable` for hashed files are correct for IIS 10 + URL Rewrite 2.1. The query string is kept on rewrite (`appendQueryString` defaults to true). `docs/deploy.md` is accurate on: the `postbuild` hook (it exists), base-href usage, the 500.19 without URL Rewrite, the Pages 404 behavior and roughly 10-minute caching, `schemaVersion` checking, and the sha256 release check.

| ID | Phase/Task | Severity (blocker/major/minor) | Finding | Owner | Status |
|---|---|---|---|---|---|
| QA-24 | P2-14 web.config | minor | The SPA fallback rewrites **every** missing path to `index.html` with 200, including missing static files. After a partial deploy, a missing `chunk-*.js`, font or `assets/data/*.json` comes back as HTML. The browser reports a MIME/parse error ("Http failure during parsing") instead of a 404, which hides the real problem. The outbound header rule is header-only, so it should be fine with compression, but it is unverified on a live IIS (deploy.md already flags the first-deploy checks). | FE | **resolved** (re-verified at `ff606c3`): the fallback matches `^(?!assets(/|$))[^.]*$` (URL Rewrite uses ECMAScript regex, case-insensitive by default, matched against the path relative to `web.config`). Exercised on 19 sample paths: app paths without an extension (including a trailing `/`) fall back, while every path with a dot (`chunk-*.js`, `media/*.woff2`, `index.htm`, `favicon.ico`) and everything under `assets/` in any case get no rewrite (real file or 404). The site root is still served by the default document. Side effects (accepted): a mistyped `index.htm` and dotted paths 404 on IIS instead of loading the app. Pages (mimic server): missing `.js`/`.json`/`.woff2` return **status 404** with the `404.html` body. That is inherent to GitHub Pages, and the loader reports "404 Not Found". Live IIS still unverified (500.52 compression check stays in deploy step 4). |
| | | | *Suggested fix:* add a condition so the fallback applies only to extension-less paths (e.g. `<add input="{REQUEST_URI}" pattern="\.[a-z0-9]+(\?|$)" negate="true" />`) or skip `assets/`. On the first IIS deploy, also request a missing `assets/data/x.json` and check for a 404. Also request `index.html` with `Accept-Encoding: gzip` and Static Compression on, and confirm a 200 (URL Rewrite outbound rules can raise 500.52 on compressed responses; this header-only rule should not, but it is unverified). | | |
| QA-25 | P2-14 docs/deploy.md | minor | Problems in the gh-pages recipe: (a) `git worktree add -b gh-pages ../gh-pages` branches from `HEAD`, so the Pages branch carries the full source history and the tracked root dotfiles (`.editorconfig`, `.gitattributes`, `.gitignore`, `.vscode/`). `rm -rf ../gh-pages/*` doesn't remove dotfiles, so they get published. (b) On that branch the main `.gitattributes` applies (`* text=auto eol=lf`), but its byte-exact exemption `src/assets/data/** -text` no longer matches the published `assets/data/`. Today's outputs are LF, so the bytes are unchanged, but the guarantee is gone. (c) A custom-domain `CNAME` added to the published files is deleted by the same `rm` on every deploy. | FE, PM | **resolved** (re-verified at `ff606c3`): walked the recipe verbatim in Git Bash (Git 2.49) in a throwaway clone with a local bare `origin` and `core.autocrlf=true`. First deploy: orphan root commit (1 parent-less commit) containing only build output and its dotfiles (`.gitattributes`, `.nojekyll`, `404.html`), no source files. `git check-attr text` = unset. All 7 data files on the branch match `manifest.json` sha256 and size; `index.html` and `404.html` are byte-identical to the build. Second deploy: a planted tracked stale chunk and an untracked file were both removed, and `src/CNAME` reached the branch through the build. |
| | | | *Suggested fix:* use an orphan branch, `git worktree add --orphan -b gh-pages ../gh-pages` (Git ≥ 2.42; 2.49 is installed), and clear it with `git -C ../gh-pages rm -rfq .` so dotfiles go too. Keep `CNAME` in `src/` and add it to `angular.json` assets so every build emits it. Optionally add a `.gitattributes` with `* -text` to the published output. | | |

**P2-12 status after P2-14:** approve. No open blocker or major findings. Open minors: QA-23, QA-24 and QA-25. Not verifiable here: a live IIS 10 deploy (URL Rewrite behavior, actual headers, compression) and a live GitHub Pages deploy.

