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

- Placeholders are laid out from the first frame in the same boxes as the real content (KPI cards, the chart area, the range control, the source line, the phone annotation key, the Notes and Settings-and-sources tiles) and become visible only after 180 ms (`SKELETON_DELAY_MS`), so fast loads don't flash.
- The chips show real labels from the start: they come from the URL and need no data. The range chip says "Fiscal years" until the data confirms which years exist.
- The chart keeps its own placeholder until ECharts has drawn its first frame, so an empty chart is never shown, including when the data is ready before the chunk.
- The loading region has `aria-busy="true"` and one polite "Loading data…" message; placeholder shapes are `aria-hidden`. With `prefers-reduced-motion: reduce` they are static.
- Error, Retry and schema-version errors replace the placeholders.

## Reproducing

The scripts used are not part of the repository. To repeat by hand: Chrome DevTools → Performance panel, Network throttling with the values above, CPU 4× slowdown, Disable cache, record a reload; read the `fx:*` marks in the Timings track and Layout Shifts in the Experience track.
