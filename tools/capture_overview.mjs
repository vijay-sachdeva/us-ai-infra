// Dev-only: produce before/after PNG + an animated GIF of the Overview cold open
// for the PR description. NOT part of CI by default. Requires Playwright + ffmpeg:
//   npm i -D playwright && npx playwright install chromium
//   ffmpeg: macOS `brew install ffmpeg` · Ubuntu `sudo apt-get install -y ffmpeg`
// Run (serve the branch first, e.g. `python -m http.server 8080` from repo root):
//   node tools/capture_overview.mjs
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const AFTER = process.env.AFTER_URL || 'http://localhost:8080/';            // serve the branch locally
const BEFORE = process.env.BEFORE_URL || 'https://vijay-sachdeva.github.io/us-ai-infra/';
const OUT = 'pr-assets';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/frames`, { recursive: true });

const VP = { width: 1200, height: 900 };
const clip = { x: 0, y: 0, width: 1040, height: 720 };   // Overview first viewport

const shot = async (url, file) => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: VP, deviceScaleFactor: 2 });
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2600);                            // let the hero settle
  await p.screenshot({ path: `${OUT}/${file}`, clip });
  await b.close();
};

const recordHero = async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: VP, deviceScaleFactor: 2 });
  await p.goto(AFTER, { waitUntil: 'domcontentloaded' });
  const stage = await p.waitForSelector('#ov-stage', { timeout: 8000 });
  let n = 0;
  for (let i = 0; i < 22; i++) {                           // phase 1: the draw + gap reveal
    await p.screenshot({ path: `${OUT}/frames/f${String(n++).padStart(3, '0')}.png`, clip });
    await p.waitForTimeout(80);
  }
  const box = await stage.boundingBox();                   // phase 2: scrub across the chart
  for (let i = 0; i <= 24; i++) {
    await p.mouse.move(box.x + (box.width * i) / 24, box.y + box.height * 0.45);
    await p.screenshot({ path: `${OUT}/frames/f${String(n++).padStart(3, '0')}.png`, clip });
    await p.waitForTimeout(55);
  }
  await b.close();
};

await shot(BEFORE, 'before.png');
await shot(AFTER, 'after.png');
await recordHero();

execSync(`ffmpeg -y -framerate 18 -i ${OUT}/frames/f%03d.png -vf "scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer" ${OUT}/overview-hero.gif`, { stdio: 'inherit' });
execSync(`ffmpeg -y -i ${OUT}/before.png -i ${OUT}/after.png -filter_complex "[0:v]scale=900:-1[a];[1:v]scale=900:-1[b];[a][b]vstack=inputs=2" ${OUT}/overview-before-after.png`, { stdio: 'inherit' });
console.log('Wrote pr-assets/{before.png, after.png, overview-before-after.png, overview-hero.gif}');
