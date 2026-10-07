# Data layout

What the raw files look like, how the pipeline reads them, and what it writes. Every statement about the raw files comes from inspecting the files in `data/raw/` (Hillsborough retrieved 2026-10-06, Pinellas 2026-10-07). Counties are a switch: the site shows one county at a time, and each county gets its own output files. `data/validation.md` has the numbers that back the checks.

## Running the pipeline

```sh
cd scripts/pipeline
npm install
npm run pipeline          # unit tests, then build src/assets/data/ from data/raw/, then validate
npm run fetch             # re-download data/raw/ and update data/raw/manifest.json (network)
npm run pipeline:refresh  # fetch + pipeline
```

- `build` works offline and is deterministic: the same raw bytes give the same output bytes. It refuses to run if a raw file's sha256 differs from `data/raw/manifest.json`.
- `validate` rebuilds in memory, requires the files on disk to match byte for byte, re-checks every total against the workbooks, writes `data/validation.md`, and exits 1 on any failure.
- Counties are configured in `scripts/pipeline/config/counties.ts`: Hillsborough and Pinellas.
- `npm run fetch -- --county <slug>` downloads only that county's own files and leaves the shared files (population, CPI, EDR index page) alone.
- `build` deletes `<slug>.observations|accounts|workbook-totals.json` files for counties that are no longer configured, and validation fails if any remain.

## Raw files (`data/raw/`)

| File | Publisher | Fetched from | Content |
|---|---|---|---|
| `edr/hillsboroughcountyrevenues.xlsx` | EDR | `.../cntyfiscal/hillsboroughcountyrevenues.xlsx` | Revenues by account and fund, FY 2005-06 to FY 2024-25 (20 sheets) |
| `edr/hillsboroughcountyexpenditures.xlsx` | EDR | `.../cntyfiscal/hillsboroughcountyexpenditures.xlsx` | Expenditures by account and fund, FY 2004-05 to FY 2024-25 (21 sheets) |
| `edr/pinellascountyrevenues.xlsx` | EDR | `.../cntyfiscal/pinellascountyrevenues.xlsx` | Pinellas revenues, FY 2005-06 to FY 2024-25 (20 sheets) |
| `edr/pinellascountyexpenditures.xlsx` | EDR | `.../cntyfiscal/pinellascountyexpenditures.xlsx` | Pinellas expenditures, FY 2004-05 to FY 2024-25 (21 sheets) |
| `edr/cntyfiscal.html` | EDR | `.../revenues-expenditures/cntyfiscal.cfm` | Index page, saved for its GASB 84 data-use notice. The page changes on every download, so its hash changes too |
| `edr-population/FLcopops.xlsx` | EDR (BEBR estimates) | `.../population-demographics/data/FLcopops.xlsx` | April 1 county population, 1972-2025 |
| `bls/CUUR0000SA0.json` | BLS | API v2 | CPI-U, U.S. city average, monthly, 2000-01 to 2026-08, plus annual averages |
| `bls/CUURS35DSA0.json` | BLS | API v2 | CPI-U, Tampa-St. Petersburg-Clearwater, bimonthly, 2017-11 to 2026-07, plus annual averages |
| `bls/CUUSS35DSA0.json` | BLS | API v2 | CPI-U, Tampa-St. Petersburg-Clearwater, semiannual and annual averages, 2000 to 2026-H1 |
| `county-afr/hillsborough/afr-fy2022.pdf` … `afr-fy2025.pdf` | Hillsborough County Clerk of Court & Comptroller | hillsclerk.com, County Financial Reports | The county's own Annual Financial Report (Florida DFS form, as filed with the CFO) for FY 2021-22 to FY 2024-25. **Used only to cross-check EDR's transcription**; never a data source |
| `manifest.json` | (pipeline) | | Raw-file manifest (P1-02): source URL, publisher, method, retrieved date (ISO), last-verified date, sha256 and byte size for each file above. Written by `npm run fetch` |

Both EDR AFR workbooks were already in the repo (`finance_data/`, moved with `git mv`). A fresh download on 2026-10-06 was byte-identical (same sha256), so their retrieval date is 2026-10-06.

BLS: `download.bls.gov` flat files return HTTP 403 to scripted clients. The public API v2 works without a registration key (limits: 10 years per request, 25 requests per day). `fetch` uses 3 requests per series. The BLS JSON is stored with each request's `responseTime` field removed. Nothing else is changed.

## EDR AFR workbooks (revenues and expenditures)

### Sheets

- One sheet per fiscal year. The sheet name is the year the fiscal year ends (`"2025"` = FY 2024-25 = Oct 1, 2024 to Sep 30, 2025). The parser checks that each sheet name matches its row 2 title.
- Revenues: sheets `2025` back to `2006`. Expenditures: sheets `2025` back to `2005`. No gaps.

### Rows

| Row | Content |
|---|---|
| 1 | Title, e.g. "Hillsborough County Government Revenues Reported by Account Code and Fund Type" (merged across) |
| 2 | "Local Fiscal Year Ended September 30, YYYY" |
| 3 | Fund group header: Governmental Funds / Proprietary Funds / Fiduciary Funds |
| 4 | Column headers (see below). Columns A-C are a merged "Account Code and Name" |
| 5 to n | Section heading rows and account rows (see below) |
| after accounts | `Total - All Account Codes` row (formulas summing the section rows) |
| +2 | Population row: label "YYYY Countywide Population:" (in 2010: "2010 Countywide Census Population:") in the columns left of the last column; the value is in the last column |
| last | Footnote: "Compiled from data obtained from the Florida Department of Financial Services, Division of Accounting and Auditing, Bureau of Local Government." |

The row positions of everything below row 4 change from year to year. The parser finds rows by content.

- **Section heading row:** text in column A and a `SUM` formula per fund over that section's account rows.
- **Account row:** column A empty, column B = account code **stored as a number** (number format `0.000` for revenues, `0` for expenditures), column C = account name, then one constant per fund column. No account row contains a formula or a blank fund cell. Every amount is a whole dollar.

### Columns

The layout changed in FY 2020-21. The parser maps columns by header text, never by position, and stops if it finds a header it doesn't recognize.

| Col | FY 2004-05 to FY 2019-20 | FY 2020-21 to FY 2024-25 | `fundType` |
|---|---|---|---|
| D | General | General | `general` |
| E | Special Revenue | Special Revenue | `special_revenue` |
| F | Debt Service | Debt Service | `debt_service` |
| G | Capital Projects | Capital Projects | `capital` |
| H | Permanent | Permanent | `permanent` |
| I | Enterprise | Enterprise | `enterprise` |
| J | Internal Service | Internal Service | `internal_service` |
| K | Pension | **Custodial** | `pension` / `custodial` |
| L | Trust | Pension | `trust` / `pension` |
| M | Component Units | Trust | `component_unit` / `trust` |
| N | Account Total `=SUM(D:M)` | Private Purpose | total / `private_purpose` |
| O | Per Capita Account Total `=N/pop` | Component Units | per capita / `component_unit` |
| P | | Total Account `=SUM(D:O)` | total |
| Q | | Per Capita Account `=P/pop` | per capita |

Groups in row 3: Governmental = General, Special Revenue, Debt Service, Capital Projects, Permanent. Proprietary = Enterprise, Internal Service. Fiduciary = Custodial, Pension, Trust, Private Purpose. Component Units sit outside those three groups.

**The workbook's Total column adds up every fund column, including fiduciary funds and Component Units.** Component Units are legally separate entities. In Hillsborough they are $3.5M to $12.5M a year in revenue.

### Formula cells vs values (P1-01)

What the downloaded files contain, checked in the raw sheet XML (`xl/worksheets/sheet1.xml` of the revenue workbook) and with exceljs for every sheet:

| Cells | In the downloaded file |
|---|---|
| Account-row fund cells (General through Component Units) | **Values** (constants). No account row in either workbook has a formula or a blank fund cell |
| Account-row Total Account / Account Total | **Formula** `=SUM(D{r}:O{r})` (FY 2021+) or `=SUM(D{r}:M{r})` (before), with a cached value |
| Account-row Per Capita | **Formula** `=(P{r}/Q$pop)` (FY 2021+) or `=(N{r}/O$pop)`, with a cached value |
| Section heading rows | **Formulas** `=SUM(...)` over the section's account rows, per fund column, plus the Total and Per Capita formulas |
| `Total - All Account Codes` row | **Formulas** summing the section rows (e.g. `=SUM(D5,D14,D26,D68,D107,D116,D127)` in revenue sheet 2025), plus Total and Per Capita |
| Population cell | **Value** |

Many formula cells are Excel "shared formulas" (only the first cell of a block stores the formula text). Every formula cell has a cached result. The pipeline never evaluates formulas: it reads account-row values, and validation compares them against the cached formula results (row totals, section subtotals, total row, per capita).

The parser uses the values Excel cached in the file. exceljs's `cell.value` drops a cached result of `0`, so `scripts/pipeline/src/lib/xlsx.ts` reads `cell.result` instead. This was checked against the raw XML, where cached zeros are stored as `<v>0</v>`.

### Section headings

Headings changed wording over the years. All of them are mapped in `SECTION_HEADINGS` in `src/edr/accounts.ts`.

| Revenues (UAS prefix) | Headings seen |
|---|---|
| 31x | General Government Taxes; Taxes |
| 32x | Permits, Fees, and Special Assessments; Permits and Franchise Fees; Franchise Fees, Licenses, and Permits; Permits, Fees, and Licenses |
| 33x | Intergovernmental Revenues; Intergovernmental Revenue |
| 34x | Charges for Services |
| 35x | Judgments, Fines, and Forfeits |
| 36x | Miscellaneous Revenues |
| 38x | Other Sources |

| Expenditures (UAS prefix) | Heading |
|---|---|
| 51x | General Government Services (Not Court-Related) |
| 52x | Public Safety |
| 53x | Physical Environment |
| 54x | Transportation |
| 55x | Economic Environment |
| 56x | Human Services |
| 57x | Culture / Recreation |
| 58x, 59x | Other Uses and Non-Operating; Other Uses |
| 60x-79x | Court-Related Expenditures |

The one place where the printed section disagrees with the code: revenue account 367 (Licenses) is printed under "Permits, Fees, and Special Assessments" in FY 2009-10 to FY 2018-19 and under Miscellaneous Revenues in other years. The pipeline classifies by code, so 367 is always `miscellaneous`. Validation lists this as a documented exception and fails on any other disagreement.

### Account codes that appear or disappear

Only 67 of 202 revenue codes and 50 of 103 expenditure codes appear in every fiscal year. The others start, stop, or have gaps. The full list, with the years each code is present and the fund types each account used by year, is generated into `data/validation.md` ("Account codes by year").

The data alone can't say whether a gap is a Uniform Accounting System code change, a reclassification by the county, or simply no activity that year. One clear case: revenue 312.1 (Local Option Taxes) runs FY 2005-06 to FY 2019-20, and 312.13 (Tourist Development Taxes) starts in FY 2020-21. Both classify as `other_taxes`, so category totals are not affected. Account-level series across such a change need a caveat.

### Account names

Account names changed wording over the years: 64 revenue codes and 47 expenditure codes have more than one printed name. Examples: "Hospital Services" became "Hospitals", and "General Gov't (Not Court-Related) - Recording Fees" became "General Government - Recording Fees". `hillsborough.accounts.json` keeps every printed name with the years it was used. Its `name` field is the most recent one.

### Cells to re-derive by hand (P1-01 / P1-09)

`data/validation.md` ("Cells to re-derive by hand") lists generated cell references for each workbook, pre- and post-FY 2020-21. Examples from the current files:

| Workbook | FY | What | Cell | Value |
|---|---|---|---|---|
| revenues | FY 2019-20 | 311 Ad Valorem Taxes, General | `2020!D6` | $833,934,111 |
| revenues | FY 2019-20 | Total - All Account Codes, Account Total | `2020!N134` | $3,861,555,795 |
| revenues | FY 2024-25 | 311 Ad Valorem Taxes, General | `2025!D6` | $1,336,984,429 |
| revenues | FY 2024-25 | Total - All Account Codes, Total Account | `2025!P134` | $9,597,307,134 |
| revenues | FY 2024-25 | Total - All Account Codes, Custodial | `2025!K134` | $4,128,975,000 (total excl. custodial $5,468,332,134) |
| revenues | FY 2024-25 | Countywide population | `2025!Q136` | 1,575,637 |
| expenditures | FY 2019-20 | 511 Legislative, General | `2020!D6` | $3,124,072 |
| expenditures | FY 2019-20 | Total - All Account Codes, Account Total | `2020!N79` | $3,674,588,853 |
| expenditures | FY 2024-25 | Total - All Account Codes, Total Account | `2025!P78` | $9,035,938,484 |
| expenditures | FY 2024-25 | Total - All Account Codes, Custodial | `2025!K78` | $4,114,554,470 (total excl. custodial $4,921,384,014) |

## FLcopops.xlsx (population)

- One sheet per April 1 reference year, named `YYYY BEBR`, `YYYY Revised BEBR` or `YYYY Census` (1972-2025). 2020 has both `2020 Revised BEBR` (Hillsborough 1,478,759) and `2020 Census` (1,459,762). 2010 and 2000 have only a census sheet.
- Row 2 B = "Countywide", row 3 B = "Population", county rows start at row 4, and column A is the county name. Revised counties carry a trailing ` *` (the 2020 revised sheet has "Hillsborough *").
- Selection rule: revised estimate, then estimate, then census. This reproduces the per-capita denominator EDR used in every AFR sheet. Validation checks this for all 41 sheets.
- **Fiscal-year alignment (decisions.md O-05, option c = EDR's own choice):** FY N uses the April 1, N value, which is exactly the population in each AFR sheet's population cell and Per Capita denominator (FY 2024-25 → April 1, 2025 = 1,575,637). This is option (b) of O-05, the April 1 of the year the FY ends. Vintage: the BEBR estimate first published for that April 1 ("Florida Estimates of Population: April 1, YYYY", BEBR, University of Florida), not later revisions. The exceptions are 2010 (census count) and 2020 (the revised BEBR estimate, "2020 Revised BEBR" sheet). Validation checks all 41 sheets.
- These are point-in-time estimates, not an intercensal-revised series. Around census years the series can jump (2009 estimate 1,196,892, then 2010 census 1,229,226). 2008 (1,200,541) is higher than 2009.

## BLS CPI

| Series | Area | Base | Frequency | Coverage in raw file |
|---|---|---|---|---|
| CUUR0000SA0 | U.S. city average | 1982-84=100 | Monthly | 2000-01 to 2026-08; annual average 2000-2025 |
| CUURS35DSA0 | Tampa-St. Petersburg-Clearwater | 1987=100 | **Bimonthly, odd months** (Jan, Mar, May, Jul, Sep, Nov) | **2017-11** to 2026-07; annual average 2018-2025 |
| CUUSS35DSA0 | Tampa-St. Petersburg-Clearwater | 1987=100 | **Semiannual** (S01 Jan-Jun, S02 Jul-Dec) + annual (S03) | 2000-H1 to 2026-H1; annual 2000-2025 |

- **Correction to the plan:** the Tampa index base is **1987=100**, not Dec 2017=100. The bimonthly series simply starts publishing in November 2017.
- The series ID CUURS35DSA0 for Tampa was verified on data.bls.gov ("All items in Tampa-St. Petersburg-Clearwater, FL, all urban consumers, not seasonally adjusted", base 1987=100). Annual averages in CUURS35DSA0 (M13) and CUUSS35DSA0 (S03) are identical for 2018-2025.
- **October 2025 national CPI is missing.** BLS footnote: "Data unavailable due to the 2025 lapse in appropriations." BLS still published a 2025 annual average (321.943), which is used as published. FY 2025-26 national has no fiscal-year average (`fiscalYearUnavailable`). It isn't needed for FY 2024-25 or earlier.
- National values before 2007 have 1 decimal. Values from 2007 on have 3.
- **Fiscal-year CPI** (Oct-Sep) is computed by the pipeline because BLS doesn't publish it.
  - National: mean of the 12 monthly values. Applied to calendar years, the same method reproduces all 25 complete BLS annual averages.
  - Tampa: mean of the 6 published bimonthly values in the fiscal year (Nov, Jan, Mar, May, Jul, Sep). Available for FY 2017-18 to FY 2024-25 only. Applied to calendar years, this method does **not** reproduce the BLS annual average: it runs 0.06-0.29% low. Each value carries that caveat.
  - Tampa before FY 2017-18: only semiannual and annual averages exist. Semiannual halves don't line up with Oct-Sep, so no fiscal-year value is produced. Tampa **calendar-year** averages exist for every finance year: `cpi.json` → `tampa_semiannual.calendarYear`.

## Outputs (`src/assets/data/`)

| File | Content |
|---|---|
| `hillsborough.observations.json` | Array of `Observation` (CLAUDE.md), one per **non-zero** fund cell of every account row: 6,924 rows, 1.74 MB (87 KB gzipped) |
| `hillsborough.accounts.json` | One row per (flow, account): `section`, `category`, latest `name`, and every printed name with its years |
| `hillsborough.workbook-totals.json` | The workbook's own cached `Total - All Account Codes` row per FY and flow (per fund, total, per capita, population). Reference values for transform tests and QA |
| `population.json` | `{ [county]: { byYear: { "2025": { value, basis, sheet } }, alternates, sourceId, ... } }` |
| `cpi.json` | `{ national, tampa, tampa_semiannual }`, each with `startPeriod`/`endPeriod`, `defaultAlignment: "fiscalYear"`, `alignmentRule` (decisions.md O-03), `monthly`, `missingMonths`, `semiannual`, `calendarYear`, `fiscalYear`, and `*Unavailable` reason maps. Every finance year (FY 2005-2025) has a key in `fiscalYear` and `calendarYear`; a year with no complete value is `null` and its reason is in `fiscalYearUnavailable` / `calendarYearUnavailable`. Partial years are never averaged and no series is spliced into another |
| `annotations.json` | `Annotation` (CLAUDE.md) plus `topic` (always set by the pipeline: `gasb84`, `transfer-imbalance`, `proprietary-fund-gap`, `fund-gap`, `rounding`, `source-anomaly`, `custodial-accounts`, `custodial-zero`, `population-source`) and optional `jurisdiction`, `flow`, `custodial` (`'included'`/`'excluded'`: show only in that mode), `measures` (show only for those `Measure`s), `detail` (longer factual text) and `refs` (cells, as `workbook:sheet!cell` with workbook `revenues`, `expenditures` or `population`, e.g. `expenditures:2024!I29`, `population:2010 Census!B31`; validated to resolve to a non-empty cell). Contains the GASB 84 marker and annotations generated from the data (see "Generated annotations" below) |
| `sources.json` | `Source` (CLAUDE.md) for every input, plus `rawFile` and `accessUrl` (the endpoint actually downloaded when `url` is a human-readable page) |
| `manifest.json` | `schemaVersion`, `dataVersion` (hash of the output hashes), input sha256s, output sha256 and byte counts. No timestamps |

Observation fields beyond CLAUDE.md:

- `flow`: `"revenue"` or `"expenditure"`.
- `section`: the major UAS group. Revenue sections are `taxes`, `permits_fees_special_assessments`, `intergovernmental`, `charges_for_services`, `judgments_fines_forfeits`, `miscellaneous`, `other_sources`. Expenditure sections are `general_government`, `public_safety`, `physical_environment`, `transportation`, `economic_environment`, `human_services`, `culture_recreation`, `other_uses`, `court_related`.
- `ref`: the sheet and cell, e.g. `"2025!D6"`.

`category` equals `section`, except that revenue account 311 is `ad_valorem` and the rest of 31x is `other_taxes`.

Zero cells are left out of `observations.json`, so a missing (FY, flow, account, fund) means 0.

Observations are sorted by jurisdiction, fiscalYear, flow (revenue first), numeric account, then fund order (column order). JSON keys are sorted. Each array element is on its own line, so git diffs stay readable.

## Generated annotations and caveats

`scripts/pipeline/src/edr/anomalies.ts` builds these from the parsed workbooks. Each one is also appended to the relevant `Source.caveats`. The text states amounts and cells only.

| Rule | Hillsborough result | Fields |
|---|---|---|
| Inter-fund transfers: \|581 − 381\| (all funds except custodial) > $1,000,000 | FY 2022-23: $624,603,841; FY 2023-24: $535,878,141. Detail gives account 521 and public safety (non-custodial) and General Fund 581 beside FY 2021-22 and FY 2024-25, the cells, and the county-filed AFR values | `flow: expenditure` |
| More than 90% of a year's non-zero amounts are whole thousands | FY 2020-21 and FY 2021-22, both flows | `flow` |
| Amount that is not a whole thousand in such a year | `2022!K8` (513, custodial, $6,802,121), with that year's custodial revenue ($6,814,851,000) | `flow: expenditure`, `custodial: included` |
| Custodial column present but all $0 | FY 2020-21, both flows | `custodial: included` |
| Accounts holding custodial amounts, per year | Revenue: 311 + 369.9 (FY 2021-22 to FY 2023-24), 369.9 + 361.1 (FY 2024-25). Expenditure: 513 (+581 in FY 2023-24) | `custodial: included` |
| Approved drop-and-recover gaps (`config/approved-gaps.ts`; full scan in data/validation.md). User decision DR-29: only filing breaks are annotated. FY 2022-23 and FY 2023-24 court-related and public safety are covered inside the `transfer-imbalance` annotations; the other 13 gaps are listed for reference only | FY 2023-24 expenditures: Enterprise $126.5M (FY 2022-23 $543.3M, FY 2024-25 $665.7M), with 534 $14.4M and 536 $0; Internal Service $18.9M ($252.1M, $344.8M), 519; Component Units $0 ($7.5M, $8.5M); physical environment section $188.3M ($586.4M, $770.6M). County-filed AFR p. 16: Enterprise $126,477,435, Internal Service $18,872,025 | `flow: expenditure` |
| Population basis changes (census year, or the year after a revised estimate) | FY 2009-10 (+2.7%, 2009 estimate to 2010 census), FY 2020-21 (+0.8%, revised 2020 estimate to 2021 estimate; 2020 census 1,459,762 noted) | `measures: [per_capita, real_per_capita]` |

### Where the FY 2022-23 and FY 2023-24 expenditure break comes from (QA-01)

The county's own Annual Financial Reports, as filed with the Florida CFO and published by the Clerk of Court & Comptroller, show the same figures as EDR. The PDFs are in `data/raw/county-afr/`. Lines checked, all verified by `npm run validate`:

| FY | Account, fund | County AFR (page) | EDR cell |
|---|---|---|---|
| 2022-23 | 521 Law Enforcement, General | $200,800 + $3,049 = $203,849 (p. 18) | `2023!D16` = 203,849 |
| 2022-23 | 581 Transfers Out, General | $787,390,037 (p. 22) | `2023!D57` |
| 2022-23 | 381 Transfers In, General | $168,326,824 (p. 16) | `2023!D124` |
| 2023-24 | 521 Law Enforcement, General | $149,313 + $1,433 = $150,746 (p. 8) | `2024!D16` = 150,746 |
| 2023-24 | 581 Transfers Out, General | $912,284,168 (p. 11) | `2024!D57` |
| 2023-24 | 381 Transfers In, General | $186,897,223 (p. 7) | `2024!D121` |
| 2021-22 / 2024-25 | 581 General; 521 General (2024-25) | $121,329,000 (p. 18); $341,118,887 and $680,677,907 (pp. 14, 11) | `2022!D54`, `2025!D56`, `2025!D16` |

So EDR transcribed the county filings faithfully, and the change in classification is in the county's filings. The audited ACFRs for FY 2023 and FY 2024 are on the same Clerk page and were not examined. DFS LOGERX was not needed. Published values are not corrected.

## Pinellas County

The workbooks have the same structure as Hillsborough's: the same sheets and years, header row 4, the same two column layouts (Custodial and Private Purpose added from FY 2020-21), the same section headings (all already mapped), and the same total, population and footnote rows. All checks in `data/validation.md` pass for Pinellas.

Differences from Hillsborough:

| Topic | Pinellas | Handling |
|---|---|---|
| Revenue accounts 39x | 392 Extraordinary Items (Gain), FY 2007-08, Enterprise $9,618,265 (`revenues:2008!I131`); 393 Non-Operating - Special Items (Gain), FY 2016-17, Enterprise $12,521,614 (`revenues:2017!I126`). Both printed under "Other Sources" | 39x classified as `other_sources` |
| Section placement | 367 Licenses printed under "Permits, Fees, and Special Assessments" in FY 2009-10, FY 2010-11 and FY 2012-13 to FY 2018-19; 313.5 printed under "Franchise Fees, Licenses, and Permits" in FY 2006-07 | Classified by code; documented per county in validation |
| Custodial timing | Column present from FY 2020-21, $0 in FY 2020-21 and FY 2021-22, first amounts in FY 2022-23 (revenue $6,221,197,931, expenditure $6,219,926,164) | `custodial-zero` rows for FY 2020-21 and FY 2021-22 plus a `custodial-start` research note at FY 2022-23 (both flows) |
| Custodial accounts | Revenue: 311, 341.9, 367, 348.42, 369.9, 342.1 (311 drops out in FY 2024-25 and 369.9 carries $3.48B). Expenditure: 513, 604, 521 | `custodial-accounts` rows |
| Transfers 381/581 | Equal to the dollar in 17 of 20 years. FY 2005-06: 581 exceeds 381 by $283,213,259; FY 2021-22: by $13,778,002; FY 2022-23: by $369,300 (below the $1,000,000 threshold, no note) | Approved `transfer-imbalance` annotations for FY 2005-06 and FY 2021-22 |
| Rounding | No years reported rounded to $1,000 | none |
| Population | 2009 estimate 931,113, 2010 census 916,542 (−1.6%); revised 2020 estimate 984,054, 2021 estimate 964,490 (−2.0%; 2020 census 959,107) | `population-source` rows (per-resident measures) |
| Drop-and-recover gaps | 3: revenue Special Revenue funds FY 2009-10 to FY 2010-11; revenue Component Units FY 2016-17; expenditure Capital funds FY 2010-11 to FY 2011-12 | Listed in validation for reference; not annotated |
| County-filed AFR cross-check | None. The Pinellas Clerk's "Annual Financial Report" is the audited ACFR (GAAP functions, not UAS accounts); the DFS-form AFR is only in DFS LOGERX | Source caveat: "Not cross-checked against the county's filed Annual Financial Report; values are reconciled to the EDR workbook totals." |

## Annotation approvals

- Transfer-imbalance years are annotated only when listed in `scripts/pipeline/config/approved-annotations.ts`. Rule: \|581 − 381\| over all funds except custodial > $1,000,000. The build fails if a flagged year is not listed, or a listed year is no longer flagged. Approved: Hillsborough FY 2022-23 and FY 2023-24; Pinellas FY 2005-06 and FY 2021-22.
- Research notes for a single county (where no other county has a comparable issue) are listed in the same file. Today there is one: Pinellas `custodial-start`.
- Drop-and-recover gaps: `config/approved-gaps.ts` (unchanged).
- The population source is shared by every county, so its generated caveats start with the county name.

## Quirks the transform engineer and QA need to know

1. **Custodial column, by year (Hillsborough).** FY 2020-21: the column exists but every cell is 0. Revenues: FY 2021-22 $6.81B, FY 2022-23 $6.79B, FY 2023-24 $2.62B, FY 2024-25 $4.13B. Expenditures: FY 2021-22 $6.8M, FY 2022-23 $6.79B, FY 2023-24 $416M, FY 2024-25 $4.11B.
   - In FY 2021-22 to FY 2023-24 most custodial revenue is booked to **account 311 (Ad Valorem Taxes)**: $6.36B, $6.28B, $2.22B. In FY 2024-25 it is booked to 369.9 (Other Miscellaneous Revenues - Other) instead.
   - Custodial expenditures are almost all account 513 (Financial and Administrative).
   - **With custodial included, "ad valorem" and total-revenue series jump by several times.** Excluding custodial (the default) is required for any comparison across FY 2020-21.
2. **Apparent scale anomaly, as published (not corrected; annotated):** FY 2021-22 expenditure custodial, account 513, cell `2022!K8` = 6,802,121. Every other FY 2021-22 amount is a whole thousand, and custodial revenue that year is $6.81B. This one value looks like it was entered in thousands. It is shown as published. If the UI shows custodial-included expenditures, FY 2021-22 should carry a caveat.
3. **FY 2020-21 and FY 2021-22 amounts are whole thousands** (all but one cell), as if reported rounded to $1,000. Other years are reported to the dollar.
4. **Totals include everything.** "All funds" as EDR prints it includes pension, trust, private purpose, custodial and Component Units. "Governmental funds" = general, special_revenue, debt_service, capital, permanent.
5. **Transfers double-count.** Inter-fund transfers appear as revenue (381) in the receiving fund and expenditure (581) in the sending fund. All-funds totals include both sides.
6. **Expenditure vs revenue years:** expenditures start in FY 2004-05, revenues in FY 2005-06.
7. **Account codes are numeric strings with trailing zeros dropped** ("312.3" for UAS 312.30). Compare codes as numbers or as these exact strings.
8. **Population** for per-capita: `population.json[county].byYear[fiscalYear]` (April 1 of the year the FY ends). This matches EDR's own per-capita column exactly.
9. **CPI:** national has fiscal-year values for FY 2000-01 to FY 2024-25. Tampa has fiscal-year values only for FY 2017-18 to FY 2024-25, and calendar-year values for 2000-2025. A Tampa option covering FY 2005-06 onward has to use calendar-year averages, or start in FY 2017-18. That is a methodology choice the UI should show.
