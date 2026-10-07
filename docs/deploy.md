# Deploying the site

The site is fully static: HTML, JS, CSS, fonts and the versioned JSON in `assets/data/`. No server code, no database, no third-party requests at runtime. Any static host works. This page covers the two planned hosts: an IIS server and GitHub Pages.

## What a build contains

`npm run build` writes `dist/hcanalyzer-ui/browser/`:

| File | Purpose |
|---|---|
| `index.html` | Entry page. Its `<base href>` sets the path the site is served from. |
| `main-*.js`, `chunk-*.js`, `styles-*.css`, `media/*` | App code, styles and self-hosted IBM Plex fonts. Names contain a content hash, so they can be cached for a long time. |
| `assets/data/*.json` | Data from the pipeline (`docs/data-layout.md`). Requested as `…json?v=<dataVersion>` from `manifest.json`. |
| `web.config` | IIS settings (below). Ignored by other hosts. |
| `404.html` | Copy of `index.html`, written by `tools/postbuild.mjs`. GitHub Pages serves it for unknown paths. |
| `.nojekyll` | Stops GitHub Pages from running Jekyll. Written by `tools/postbuild.mjs`. |

`postbuild` runs automatically after `npm run build`. If you run `ng build` directly, run `node tools/postbuild.mjs` afterwards.

Before building, make sure the data is current (`scripts/pipeline`, `npm run pipeline`). The site checks `manifest.json` `schemaVersion` on load and shows an error instead of a chart if the data and the site don't match.

## Base href: root or sub-path

The site must know the URL path it is served from.

| Served at | Build command |
|---|---|
| Site root, e.g. `https://finance.example.org/` | `npm run build` (base href `/`) |
| A sub-path, e.g. `https://example.org/county-finance/` | `npm run build -- --base-href /county-finance/` |
| GitHub Pages project site `https://<user>.github.io/HCAnalyzer-UI/` | `npm run build:pages` |

- The base href must start and end with `/`.
- `build:pages` uses the `github-pages` configuration in `angular.json` (`baseHref: "/HCAnalyzer-UI/"`). If the repository has a different name, change that value, or run `npm run build -- --base-href /<repo-name>/`.
- Data, font and bundle URLs are relative, so they follow the base href. This was verified by serving the build under `/HCAnalyzer-UI/`: every request stayed under the sub-path, deep links and reloads worked.

The site has one route. Every setting is in the query string (`?flow=…&measure=…`), so a shared link reproduces a view on any host. An unknown path loads the app, which redirects to its route.

## IIS

Requirements: IIS 10 with the Static Content feature, and the **URL Rewrite** module (free download from Microsoft, "IIS URL Rewrite 2.1"). `web.config` uses URL Rewrite for the unknown-path fallback and for the no-cache header on HTML. Without the module IIS returns HTTP 500.19 for every request.

1. Build with the right base href (see the table above). For a site root: `npm run build`.
2. Create the target:
   - **Own site:** in IIS Manager, Sites → Add Website. Physical path: an empty folder, e.g. `C:\inetpub\county-finance`. Bind the host name and HTTPS certificate.
   - **Sub-path of an existing site:** right-click the site → Add Application. Alias = the sub-path (e.g. `county-finance`), physical path = an empty folder. Build with `--base-href /county-finance/`.
3. Copy the **contents** of `dist/hcanalyzer-ui/browser/` (not the folder itself) into the physical path, including `web.config`. Replace all old files; deleting the old ones first is safest, since bundle names change each build.
4. Browse to the site. Check: the chart loads; `…/anything` loads the app; the browser dev tools Network tab shows `assets/data/*.json` with `Cache-Control: no-cache` and `main-*.js` with `Cache-Control: public, immutable, max-age=31536000`. Then do the release checks below.

What `web.config` sets:

- MIME types for `.json`, `.woff`, `.woff2`, `.webmanifest` (older IIS versions don't serve unknown types).
- Unknown paths that aren't real files or folders are rewritten to `index.html`.
- Caching: one year (`public, immutable`) by default, since bundles and fonts are content-hashed; `no-cache` (revalidate every time) for `index.html`, `404.html`, `assets/data/` and any HTML response; one day for `favicon.ico`.
- Default document `index.html`.

The `web.config` is well-formed XML but has **not yet been tested on an IIS server**. Do the checks in step 4 on the first deployment.

Compression: enable Static Content Compression in IIS (Server → Compression) for `.js`, `.css` and `.json`. The observations file is about 1.7 MB raw and about 90 KB compressed.

## GitHub Pages

1. In the repository on GitHub: Settings → Pages → Build and deployment → Source: **Deploy from a branch**. Choose a branch (e.g. `gh-pages`) and folder `/ (root)`.
2. Build: `npm run build:pages` (or `npm run build -- --base-href /<repo-name>/`).
3. Publish the **contents** of `dist/hcanalyzer-ui/browser/` to the root of that branch. One way, from the repository root:

   ```sh
   git worktree add ../gh-pages gh-pages        # first time: git worktree add -b gh-pages ../gh-pages
   rm -rf ../gh-pages/*                         # keeps ../gh-pages/.git
   cp -r dist/hcanalyzer-ui/browser/. ../gh-pages/
   cd ../gh-pages && git add -A && git commit -m "Deploy <commit or date>" && git push origin gh-pages
   ```

   Make sure `.nojekyll` and `404.html` are included (`cp -r …/browser/.` copies dotfiles).
4. Wait for the Pages deployment to finish (Actions tab, "pages build and deployment"), then open `https://<user>.github.io/<repo-name>/`.

For a custom domain, set it under Settings → Pages; the site is then at the domain root, so build with `npm run build` (base href `/`) and add a `CNAME` file containing the domain to the published files.

Notes:

- GitHub Pages answers unknown paths with `404.html` and HTTP status 404. The app still loads and redirects to its route, but the first response for a mistyped path has status 404. Normal links (`…/<repo-name>/?flow=…`) return 200.
- GitHub Pages sets its own cache headers (about 10 minutes for everything). Data files are still versioned by `?v=<dataVersion>`, so a new data build is never mixed with old data.
- No GitHub Actions workflow is included. Publishing is a deliberate manual step.

## Checklist for every release

1. `npm test` and `npm run build` (or `build:pages`) pass.
2. `scripts/pipeline`: `npm run pipeline` passes, and `src/assets/data/manifest.json` is the version you mean to publish.
3. Publish the complete `browser/` folder; remove files from the previous build.
4. Open a shared URL with query params (for example `…/?flow=expenditure&measure=per_capita&from=2015&to=2025`): the same view appears, with the same KPI values, as in a local `npm start`. Change a setting and reload: the view is restored from the URL.
5. Check that the data the host serves is the data you built:
   - Open `<site>/assets/data/manifest.json`. Its `dataVersion` must equal the one in `src/assets/data/manifest.json` in the commit you built.
   - Checksums: the manifest lists a `sha256` for every data file. To check one file on the host, download it and compare, e.g. `curl -s <site>/assets/data/cpi.json | sha256sum` (PowerShell: `Invoke-WebRequest <url> -OutFile cpi.json; Get-FileHash cpi.json`) against the manifest's `outputs` entry.
6. Check one value against `data/validation.md`.
