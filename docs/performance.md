# Load performance

Measurements behind P2-15 (skeleton loaders). Re-run them when the data, the chart library or the loading code changes.

## Method

- Production build (`npm run build:pages`), served with gzip under the `/HCAnalyzer-UI/` sub-path by a local static server. Cold cache (browser cache disabled), headless Chrome driven by Playwright with CDP throttling.
- Two profiles, values set explicitly (not a named DevTools preset):

| Profile | Latency | Down | Up | CPU |
|---|---|---|---|---|
| Fast 4G | 60 ms | 9 Mbps | 1.5 Mbps | 4× slowdown |
| Slow 4G (Lighthouse "mobile") | 150 ms | 1.6 Mbps | 750 kbps | 4× slowdown |

- Phone viewport 390×844 unless noted; desktop runs use 1366×900. Median of 3 runs. Times are ms from navigation start.
- Timing marks in the app (standard Performance API, kept in production): `fx:dataReady` (all data files parsed), `fx:buildSeries` (a measure around each series computation), `fx:chartInit` (ECharts instance created), `fx:chartRendered` (first frame drawn). Network times come from Resource Timing.
- CLS from a `layout-shift` PerformanceObserver over the whole load.

## Results (2026-10-07)

Transferred: data files 100 KB (the 1.7 MB `hillsborough.observations.json` is about 87 KB gzipped); ECharts chunk 216 KB.

| | Fast 4G before | Fast 4G after | Slow 4G before | Slow 4G after |
|---|---|---|---|---|
| First contentful paint | 528 | 496 | 1216 | 1224 |
| `manifest.json` loaded | 763 | 752 | 2064 | 2082 |
| All data files loaded | 1063 | 1072 | 2830 | 3285 |
| Data ready (`fx:dataReady`) | 1093 | 1128 | 2862 | 3314 |
| ECharts chunk request starts | 1327 | 680 | 3111 | 1923 |
| ECharts chunk loaded | 1620 | 1039 | 4473 | 4056 |
| First `buildSeries` | 8.5 | 10 | 9.3 | 10.2 |
| ECharts instance created (`fx:chartInit`) | 1673 | 1551 | 4557 | 4105 |
| First chart frame (`fx:chartRendered`) | n/a | 1824 | n/a | 4284 |
| CLS, phone | 0 | 0 | 0 | 0 |
| CLS, desktop | 0.0297 | 0 | 0.0297 | 0 |

Run-to-run variation is roughly ±150 ms on Fast 4G.

## What the numbers say

- **The biggest wait was the chart library loading after the data.** The ECharts chunk was only requested once the data had arrived and the chart component rendered. The explorer now starts `import('../core/echarts')` when it initializes, in parallel with the data (same module as the ngx-echarts provider, so it downloads once). On Slow 4G the chart is ready about 0.45 s sooner. On Slow 4G the data itself arrives later than before, because it shares bandwidth with the chunk.
- **The series computation is not a wait.** The first `buildSeries` takes about 10 ms even with a 4× CPU slowdown, so it gets no loading state.
- **Layout shift.** Before, the Settings-and-sources tile moved when the range control and source line appeared (desktop CLS 0.0297). The skeletons now hold every box the content will fill, so CLS is 0.

## Loading behavior (P2-15)

- Placeholders are laid out from the first frame in the same boxes as the real content (KPI cards, the chart area, the range control, the source line, the phone annotation key, the Notes and Settings-and-sources tiles) and become visible only after 180 ms (`SKELETON_DELAY_MS`), so fast loads don't flash. The delay runs once per load: a placeholder that appears later in the load (such as the chart's own) is shown at once, not after a second delay.
- The chips show real labels from the start: they come from the URL and need no data. The range chip says "Fiscal years" until the data confirms which years exist.
- When the data arrives, the page's chart placeholder is replaced by the chart component's own placeholder, which stays until ECharts has drawn its first frame (`fx:chartRendered`). The chart area is never empty in between: see the per-frame check below.
- The loading region has `aria-busy="true"` and one polite "Loading data…" message; placeholder shapes are `aria-hidden`. With `prefers-reduced-motion: reduce` they are static.
- After a failed load (missing file, schema-version mismatch), the error message and Retry replace the placeholders and no placeholder remains anywhere on the page, the range control included. The range chip keeps saying "Fiscal years" and the KPI cards say "Data not loaded".

## Reproducing

With the scripts in the repository (QA, `qa/phase2/`):

1. Build: `npm run build`.
2. Serve the build with gzip, like the real hosts, with [`qa/phase2/gzip-server.mjs`](../qa/phase2/gzip-server.mjs): `node qa/phase2/gzip-server.mjs dist/hcanalyzer-ui/browser 4300 <logFile>`. Optional `HOLD_MATCH` / `HOLD_MS` environment variables delay matching requests (for example the ECharts chunk) to force the "data ready, chart not" state. The log lists every request, so duplicate fetches can be counted.
3. Run the probe, [`qa/phase2/load-probe.mjs`](../qa/phase2/load-probe.mjs): `node qa/phase2/load-probe.mjs http://localhost:4300 <outDir> '<scenarios JSON>'`, for example `'[{"name":"slow-phone","query":"?flow=revenue","width":390,"height":844,"mobile":true,"net":"slow4g","cpu":4}]'`. It records every animation frame and reports the `fx:*` marks, CLS and layout shifts, when skeletons became visible, aria-busy and live-region changes, and `gapFrames`: frames in which the chart area showed neither a skeleton nor the chart. The scenario options are listed at the top of the script.

The probe's `slow4g`/`fast4g` are the DevTools presets (Slow 4G: 562.5 ms latency, about 1.3 Mbps down), harsher than the profile in the table above, so its absolute times are later.

By hand: Chrome DevTools → Performance panel, Network throttling as above, CPU 4× slowdown, Disable cache, record a reload; read the `fx:*` marks in the Timings track and Layout Shifts in the Experience track.

## Chart area never blank (QA-26 re-check, 2026-10-07)

Per-frame check, from the first visible placeholder until the first drawn chart frame (`fx:chartRendered`), each animation frame classified as page skeleton, chart skeleton, chart, or blank. DevTools Slow 4G and Fast 4G presets, CPU 4×, cold cache, 5 runs each at 390 px and 1366 px (20 runs): every run went page skeleton → chart skeleton → chart with **0 blank frames; the longest blank gap was 0 ms on Slow 4G and on Fast 4G**. `qa/phase2/load-probe.mjs` reports `gapFrames: 0` for the same Slow 4G phone and desktop scenarios. Before the fix, QA measured a blank chart area of up to about 400 ms.
