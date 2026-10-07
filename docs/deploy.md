# Deploying the site

The site is fully static: HTML, JS, CSS, fonts and the versioned JSON in `assets/data/`. No server code, no database. The only possible third-party request is the optional, cookieless Cloudflare Web Analytics beacon, which is off unless a token is set at build time (see [Analytics](#analytics-optional)). Any static host works. This page covers the two planned hosts: an IIS server and GitHub Pages.

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
| `.gitattributes` | `* -text`: keeps published files byte-exact when committed to the `gh-pages` branch. Written by `tools/postbuild.mjs`. |
| `CNAME` | Only if `src/CNAME` exists: the GitHub Pages custom domain. |

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
4. Browse to the site. Check: the chart loads; `…/anything` loads the app; `…/assets/data/missing.json` and `…/missing.js` return 404 (not the app); the browser dev tools Network tab shows `assets/data/*.json` with `Cache-Control: no-cache` and `main-*.js` with `Cache-Control: public, immutable, max-age=31536000`. Then do the release checks below.

What `web.config` sets:

- MIME types for `.json`, `.woff`, `.woff2`, `.webmanifest` (older IIS versions don't serve unknown types).
- Unknown app paths are rewritten to `index.html`: only paths that aren't real files or folders, have no file extension, and are outside `assets/`. A missing `chunk-*.js`, font or `assets/data/*.json` returns a real 404, which makes an incomplete deploy easy to spot.
- Caching: one year (`public, immutable`) by default, since bundles and fonts are content-hashed; `no-cache` (revalidate every time) for `index.html`, `404.html`, `assets/data/` and any HTML response; one day for `favicon.ico`.
- Default document `index.html`.

The `web.config` is well-formed XML but has **not yet been tested on an IIS server**. Do the checks in step 4 on the first deployment.

Compression: enable Static Content Compression in IIS (Server → Compression) for `.js`, `.css` and `.json`. The observations file is about 1.7 MB raw and about 90 KB compressed.

### First-deploy check: compression and the outbound rule (HTTP 500.52)

`web.config` has one URL Rewrite **outbound** rule: it sets `Cache-Control: no-cache` on HTML responses. URL Rewrite can fail with **HTTP 500.52** ("outbound rewrite rules cannot be applied when the content of the HTTP response is encoded") when an outbound rule meets a compressed response. Our rule only changes a response header, not the body, so it may not be affected, but this has not been tested on a live IIS. Check it once compression is on:

```powershell
# Expect 200 for each. A 500 (sub-status 52 in the IIS log) means the outbound rule conflicts with compression.
foreach ($u in 'https://<site>/', 'https://<site>/index.html', 'https://<site>/some/deep/link') {
  $r = Invoke-WebRequest $u -Headers @{ 'Accept-Encoding' = 'gzip' } -SkipHttpErrorCheck
  "{0}  {1}  Content-Encoding={2}  Cache-Control={3}" -f $r.StatusCode, $u, $r.Headers['Content-Encoding'], $r.Headers['Cache-Control']
}
```

(`curl -s -o /dev/null -w "%{http_code}\n" -H "Accept-Encoding: gzip" https://<site>/` does the same from a shell.) Also check that `Cache-Control` on these HTML responses is `no-cache`.

If any request returns 500.52, use this fallback (known to be safe):

1. Delete the whole `<outboundRules>` block from `web.config` on the server (and in `src/web.config` for later builds).
2. Nothing else is needed for caching: the `<location path="index.html">` entry already sends `no-cache` for `index.html`, which is the file the default document and the unknown-path rewrite both serve. Re-run the check above: expect 200 and `Cache-Control: no-cache`.

Other remedies exist but were **not verified** for this project, so treat them as pointers, not instructions:

- Microsoft's URL Rewrite documentation describes using outbound rules together with **dynamic** compression by setting the registry value `LogRewrittenUrlEnabled` (DWORD, `0`) under `HKLM\Software\Microsoft\Inetstp\Rewrite` and changing the order of the compression and rewrite modules. Check Microsoft's current URL Rewrite 2.1 documentation before changing the registry.
- Turning off **dynamic** compression for HTML avoids the conflict; static compression of `.js`, `.css` and `.json` is unaffected.
- `rewriteBeforeCache` (an attribute of `<outboundRules>`) concerns the kernel output cache, not compression; it is not a known fix for 500.52.

## GitHub Pages

The site is published from a separate **orphan** branch, `gh-pages`, that contains only the build output: no source history, no source dotfiles. It is checked out as a git worktree next to the repository (`../gh-pages`), so publishing never touches your working tree.

1. In the repository on GitHub: Settings → Pages → Build and deployment → Source: **Deploy from a branch**. Branch `gh-pages`, folder `/ (root)`. (The branch must exist first; it is created and pushed in step 3 on the first deploy.)
2. Build: `npm run build:pages` (or `npm run build -- --base-href /<repo-name>/`).
3. Publish the **contents** of `dist/hcanalyzer-ui/browser/` to the root of `gh-pages`. From the repository root (Git 2.42 or later; Git Bash on Windows):

   ```sh
   # First deploy only: create an empty orphan branch in a worktree.
   git worktree add --orphan -b gh-pages ../gh-pages
   # Later deploys, if the worktree was removed: git worktree add ../gh-pages gh-pages

   # Every deploy:
   git -C ../gh-pages rm -rfq --ignore-unmatch .      # remove all tracked files, dotfiles included
   git -C ../gh-pages clean -fdxq                     # and any untracked leftovers
   cp -r dist/hcanalyzer-ui/browser/. ../gh-pages/    # "/." copies dotfiles too
   git -C ../gh-pages add -A
   git -C ../gh-pages commit -qm "Deploy $(git rev-parse --short HEAD)"
   git -C ../gh-pages push origin gh-pages
   ```

   The build output carries the files Pages needs, written by `tools/postbuild.mjs`:
   - `404.html` (deep links) and `.nojekyll` (no Jekyll processing);
   - `.gitattributes` with `* -text`, so git stores every published file byte for byte. The data JSON on the branch then keeps the sha256 values in `manifest.json`, whatever line-ending settings the machine has.
4. Wait for the Pages deployment to finish (Actions tab, "pages build and deployment"), then open `https://<user>.github.io/<repo-name>/`.

### Custom domain

1. Put the domain, alone on one line, in `src/CNAME` (for example `finance.example.org`) and commit it. `angular.json` copies `src/CNAME` into every build, so the deploy steps above never drop it. Without `src/CNAME` no `CNAME` file is published.
2. On a custom domain the site is at the domain root: build with `npm run build` (base href `/`), not `build:pages`.
3. Set the same domain under Settings → Pages → Custom domain, and configure DNS as GitHub's Pages documentation describes.

Notes:

- GitHub Pages answers unknown paths with `404.html` and HTTP status 404. The app still loads and redirects to its route, but the first response for a mistyped path has status 404. Normal links (`…/<repo-name>/?flow=…`) return 200.
- GitHub Pages sets its own cache headers (about 10 minutes for everything). Data files are still versioned by `?v=<dataVersion>`, so a new data build is never mixed with old data.
- No GitHub Actions workflow is included. Publishing is a deliberate manual step.

## Analytics (optional)

The site can count page views with **Cloudflare Web Analytics**: no cookies, no personal data, no cross-site tracking. It is **off by default**: with no token nothing is loaded, and `ng test` and `npm start` use the empty default.

How it works (`src/app/core/analytics.ts`):

- The token is a build-time constant, `CF_ANALYTICS_TOKEN`. `angular.json` defines it as `''` (empty = off).
- With a token, after the first render the app adds one script to the page: `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"…","spa":false}'>`. `spa: false` counts page loads only, not settings changes.
- It is skipped entirely when the browser sends Do Not Track (`navigator.doNotTrack === '1'`) or Global Privacy Control (`navigator.globalPrivacyControl === true`).
- If the beacon is blocked or fails, nothing happens: no error state, no layout change.
- "Settings and sources" shows a Privacy line only in builds with a token.

Get the token: Cloudflare dashboard → Analytics & Logs → Web Analytics → Add a site → enter the site's host name (one site per host: GitHub Pages and IIS are separate sites with separate tokens) → choose the JavaScript snippet option and copy the `token` value from the snippet. The token is not secret; it appears in the published page.

Where the tokens live (`angular.json`, `CF_ANALYTICS_TOKEN` under `define`):

| Build | Token | Command |
|---|---|---|
| GitHub Pages (`robertbrownns.github.io`) | Set: `1b211162f18241c7b2899d54d542a420`, in the `github-pages` configuration | `npm run build:pages` (nothing else needed) |
| IIS (default/root build) | Empty: analytics off | `npm run build` |
| `npm start` (`ng serve`), `npm test` | Empty: analytics off | — |

The token is public by design: it appears in the published page.

**Adding the IIS token later.** Create a separate Web Analytics site in Cloudflare for the IIS host name (one site per host), copy its token, then either:

- set it for every IIS build: in `angular.json`, add `"define": { "CF_ANALYTICS_TOKEN": "'<iis-token>'" }` to the **`production`** configuration (keep the single quotes inside the double quotes). `npm run build` uses `production`; `npm start` uses `development` and tests use the empty default, so both stay off. Don't put it under `build.options`: that would switch it on for `npm start` too. `build:pages` applies `production` then `github-pages`, so the Pages token still wins for that build; or
- pass it for one build: `npm run build -- --define "CF_ANALYTICS_TOKEN='<iis-token>'"` (add `--base-href /county-finance/` for a sub-path). This works in PowerShell and Git Bash.

To turn analytics off for a build, set the value back to `"''"`.

Check a token build: open the site, then dev tools → Network: one request to `static.cloudflareinsights.com/beacon.min.js` (then the beacon's page-view report to `cloudflareinsights.com/cdn-cgi/rum`), and the Privacy line under "Settings and sources". With Do Not Track or GPC on, there is no request. Local test loads of a token build count as page views unless you block the report request.

**web.config needs no change.** It sets no Content-Security-Policy, so the beacon script and its report request to `cloudflareinsights.com` are allowed. If a CSP is added later, it must allow `script-src https://static.cloudflareinsights.com` and `connect-src https://cloudflareinsights.com`.

## Checklist for every release

1. `npm test` and `npm run build` (or `build:pages`) pass.
2. `scripts/pipeline`: `npm run pipeline` passes, and `src/assets/data/manifest.json` is the version you mean to publish.
3. Publish the complete `browser/` folder; remove files from the previous build.
4. Open a shared URL with query params (for example `…/?flow=expenditure&measure=per_capita&from=2015&to=2025`): the same view appears, with the same KPI values, as in a local `npm start`. Change a setting and reload: the view is restored from the URL.
5. Check that the data the host serves is the data you built:
   - Open `<site>/assets/data/manifest.json`. Its `dataVersion` must equal the one in `src/assets/data/manifest.json` in the commit you built.
   - Checksums: the manifest lists a `sha256` for every data file. To check one file on the host, download it and compare, e.g. `curl -s <site>/assets/data/cpi.json | sha256sum` (PowerShell: `Invoke-WebRequest <url> -OutFile cpi.json; Get-FileHash cpi.json`) against the manifest's `outputs` entry.
6. Check one value against `data/validation.md`.
