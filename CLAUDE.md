# Florida County Finance Explorer

Mobile-first Angular site for researching Florida county finances over time, built in the context of Florida's 2026 Amendment 3 (homestead property tax exemption, on the Nov 3, 2026 ballot). Starting jurisdiction: **Hillsborough County**.

## Guiding principle: neutrality

- Every number on screen must trace back to an official source (publisher, file, account code, fiscal year, retrieval date).
- The site never tells users what to conclude. No editorial copy, no "verdicts."
- Methodology choices (base year, inflation index, fund scope, custodial funds) are user-controlled and always visible.
- Use official government data only. Do NOT use advocacy-group figures (League of Cities, Florida Policy Institute, Florida TaxWatch, CFO/DOGE press releases, campaign sites) as data sources. They may be referenced only as "claim presets" that reproduce the settings behind a published claim.

## Data sources (official)

| Dataset | Publisher | URL |
|---|---|---|
| Hillsborough revenues, FY 2006–2025 | Florida Legislature, Office of Economic & Demographic Research (EDR), from county Annual Financial Reports | https://edr.state.fl.us/Content/local-government/data/revenues-expenditures/cntyfiscal/hillsboroughcountyrevenues.xlsx |
| Hillsborough expenditures, FY 2005–2025 | EDR | https://edr.state.fl.us/Content/local-government/data/revenues-expenditures/cntyfiscal/hillsboroughcountyexpenditures.xlsx |
| Other counties | EDR index page | https://edr.state.fl.us/Content/local-government/data/revenues-expenditures/cntyfiscal.cfm |
| Glossary of AFR terms | EDR | https://edr.state.fl.us/Content/local-government/data/revenues-expenditures/glossary.doc |
| Population estimates | EDR population & demographics | https://edr.state.fl.us/Content/population-demographics/data/index.cfm |
| Inflation | BLS CPI-U (national) and Tampa–St. Petersburg–Clearwater CPI | https://www.bls.gov/cpi/ |
| Millage rates, taxable values | Florida Department of Revenue | https://floridarevenue.com/property/ |
| Raw AFRs (if needed) | Florida DFS Open Financial Statement System | https://logerx.myfloridacfo.gov/LogerX/PublicReportsMenu |
| Amendment 3 fiscal impact | EDR Revenue Estimating Conference (July 10, 2026 report) | https://edr.state.fl.us/Content/constitutional-amendments/index.cfm |

Inspect the actual xlsx structure before writing the parser. Do not assume column layout.

### Critical caveat: Custodial Fund (GASB 84)

Starting **FY 2020-21**, the AFR added a **Custodial Fund** column (GASB Statement No. 84). It records money the county holds or collects for others (e.g., Tax Collector property taxes collected for the School Board, cities, special districts; Clerk court registry, bonds, child support). It is not a correction and not county money to spend. Years before and after FY 2020-21 are **not comparable** unless custodial amounts are excluded. EDR notes the Total Account and Per Capita columns are formula-driven and recalculate if the Custodial column is removed.

- Default: custodial EXCLUDED.
- Always show a chart annotation at FY 2020-21: "Custodial fund reporting begins (GASB 84)."
- Validation: totals-excluding-custodial must match the recalculated EDR totals.

Fiscal year convention: Florida county FY runs Oct 1 – Sep 30. Store `fiscalYear: 2021` for FY 2020-21 and display "FY 2020-21".

## Tech stack

- Angular (latest), standalone components, signals. Controls are signals; chart data is a `computed`.
- Apache ECharts via `ngx-echarts` (touch pinch-zoom, dataZoom slider, PNG export).
- Angular Material (or a light custom set) for bottom sheet, chips, toggles.
- Static hosting only. No backend, no tracking, no accounts.
- Data is processed at build time (state sites block browser CORS fetches) into versioned JSON with checksums.

## Data model

```ts
interface Observation {
  jurisdiction: string;   // "hillsborough"
  fiscalYear: number;     // 2021 = FY 2020-21
  account: string;        // e.g. "311" ad valorem taxes
  category: string;       // "ad_valorem" | "public_safety" | ...
  fundType: 'general' | 'special_revenue' | 'debt_service' | 'capital'
          | 'permanent' | 'enterprise' | 'internal_service' | 'custodial' | string;
  amount: number;         // nominal USD
  sourceId: string;
}

interface Source {
  id: string; publisher: string; title: string; url: string;
  retrieved: string;      // ISO date
  sha256: string;
  caveats: string[];
}

interface Annotation {
  fiscalYear: number; label: string;
  kind: 'methodology' | 'policy' | 'event';
  sourceId: string;
}
```

Population and CPI are separate year-keyed series joined in the browser.

## Features

Controls (all reflected in URL query params so links reproduce views):
- **Measure:** nominal / per resident / inflation-adjusted / per resident + inflation-adjusted
- **Base year:** any year; optional index-to-100
- **Date range:** slider + presets
- **Custodial:** include / exclude (default exclude)
- **Fund scope:** General Fund / governmental funds / all funds
- **Category breakdown:** ad valorem revenue, public safety, transportation, general government, etc.
- **Chart type:** line, stacked area, bar, % share
- **Compare jurisdictions:** overlay other counties / statewide
- **Inflation index:** national CPI-U vs Tampa metro CPI

Context:
- Methodology annotations on charts (GASB 84 line, millage changes, one-time federal funds).
- Source drawer: tap a data point to see source, account code, FY, caveats.
- "Claim presets": load the settings behind a published claim (e.g., FY 2019-20 → FY 2024-25 General Fund growth). Settings only, no verdicts.
- "View as table" toggle for every chart.

Export: CSV (with source columns) and PNG (with settings and sources printed under the chart).

`transform.ts` must be pure and fully unit-tested; it's the part people will audit.

## Mobile-first layout

- Phone: chart ~60% of viewport; chip row of active settings; tap chip -> bottom sheet; pinch zoom; range slider under chart.
- Tablet: collapsible side panel. Desktop: persistent filters pane on the RIGHT, optional second chart.
- Touch targets >= 44px, colorblind-safe palette, light/dark support.
- Visual theme: "BI dashboard" (docs/decisions.md D-07). Navy top bar, white tiles on grey canvas, KPI cards, IBM Plex Sans/Mono self-hosted. All visual values live in `src/styles/_tokens.scss`. KPI cards show only values derived from the user's own settings, with no chosen comparison periods and no good/bad coloring.

## Build phases

1. **Data pipeline** (start here): download Hillsborough revenue + expenditure xlsx, population, CPI into `data/raw/`; inspect structure; parse to normalized JSON; validation report (source totals match; custodial-excluded totals match EDR recalculation).
2. **MVP explorer:** one line chart; measure, base year, range, custodial toggle; URL state.
3. **Breakdowns:** fund scope, categories, stacked/share charts, source drawer, annotations.
4. **Comparison:** other counties + statewide.
5. **Presets + export:** claim presets, CSV/PNG, methodology page.
6. **Polish:** accessibility audit, performance, PWA/offline.

## Decided

- Public site. Hosted statically on either a private IIS server or GitHub Pages, so builds must work under a sub-path base href and on IIS. Methodology and "how to reproduce" pages are a priority.
- Transfers between funds: the UI offers both gross (as reported) and net. Default is gross.
- Inflation: the UI offers every index and period combination (national CPI-U / Tampa CPI × fiscal-year / calendar-year averages). Default is national CPI-U, fiscal-year.
- Comparison counties: none yet. Phase 4 is on hold; keep the pipeline county-agnostic.

## Open decisions

- Include cities and special districts later? (County-only first.)