// Runs after `npm run build` (npm "postbuild" hook). Adds the files static hosts need that
// Angular doesn't emit:
//   404.html  - GitHub Pages serves it for unknown paths; a copy of index.html so the app
//               boots (and redirects to its route) instead of showing a 404 page.
//   .nojekyll - tells GitHub Pages not to run Jekyll, which would drop files starting with "_".
// web.config (IIS) is copied by angular.json "assets". Usage: node tools/postbuild.mjs [outDir]
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'dist/hcanalyzer-ui/browser';
const index = join(outDir, 'index.html');

if (!existsSync(index)) {
  console.error(`postbuild: ${index} not found. Run "ng build" first.`);
  process.exit(1);
}

copyFileSync(index, join(outDir, '404.html'));
writeFileSync(join(outDir, '.nojekyll'), '');
console.log(`postbuild: wrote 404.html and .nojekyll in ${outDir}`);
