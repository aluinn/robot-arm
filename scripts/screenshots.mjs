// Captures the README screenshots into docs/assets/ using a headless browser.
// Usage: npm run screenshots   (starts its own static server; set PW_CHANNEL=chrome to use installed Chrome)
// The page is loaded with ?debug, which exposes window.__app so the script can fast-forward the
// fixed-step simulation instead of waiting in real time.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../docs/assets/', import.meta.url));
const port = 4391 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(port)], { stdio: 'ignore' });
const base = `http://localhost:${port}/?debug`;
await mkdir(out, { recursive: true });

const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
if (process.env.PW_CHANNEL) launch.channel = process.env.PW_CHANNEL;
const browser = await chromium.launch(launch);

async function open(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForFunction(() => window.__app, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  return page;
}
const settle = (page, ms = 1200) => page.waitForTimeout(ms);
const shot = (page, name) => page.screenshot({ path: `${out}${name}.png` });
// advance the simulation (120 Hz fixed steps) until cond() or the step budget runs out
const run = (page, cond, budget = 60000) => page.evaluate(([c, n]) => {
  const f = new Function('app', `return (${c})(app)`);
  for (let i = 0; i < n && !f(window.__app); i++) window.__app.simStep();
}, [cond.toString(), budget]);

try {
  const desktop = { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 };

  // 1. overview with the default layout
  let page = await open(desktop);
  await page.evaluate(() => window.__app.actions.setPreset('hero'));
  await settle(page, 2000);
  await shot(page, 'screenshot-overview');

  // 2. Auto-Build: pyramid, half way, then finished
  await page.evaluate(() => { window.__app.actions.selectStructure('pyramid'); });
  await settle(page, 800);
  await page.evaluate(() => window.__app.actions.startBuild());
  await run(page, (a) => a.build.filled.filter(Boolean).length >= 3);
  await settle(page);
  await shot(page, 'screenshot-autobuild-progress');
  await run(page, (a) => a.build.state === 'done');
  await page.evaluate(() => window.__app.actions.setPreset('front'));
  await settle(page, 3000);
  await shot(page, 'screenshot-autobuild-done');

  // 3. challenge with ghost target
  await page.evaluate(() => window.__app.actions.startChallenge('pyramid'));
  await settle(page, 2000);
  await shot(page, 'screenshot-challenge');

  // 4. joints mode
  await page.evaluate(() => { window.__app.actions.reset(); window.__app.actions.cancelChallenge(); window.__app.actions.setMode('joints'); });
  await settle(page, 1500);
  await shot(page, 'screenshot-joints');

  // 5. clean mode (UI hidden) for a hero-style render
  await page.evaluate(() => window.__app.actions.setMode('cartesian'));
  await page.keyboard.press('h');
  await settle(page, 2000);
  await shot(page, 'screenshot-clean');
  await page.context().close();

  // 6. phone
  page = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluate(() => window.__app.actions.setMode('cartesian'));   // shorter panel leaves room for the arm
  await settle(page, 3500);
  await shot(page, 'screenshot-phone');
  await page.context().close();
} finally {
  await browser.close();
  server.kill();
}
console.log('Screenshots written to docs/assets/');
