// Measures the cost of one fixed simulation step (commands + arm + physics) in a real browser.
// Rendering is excluded; p95 and worst are over batches of 50 steps: steps are driven through window.__app.simStep() (available with ?debug).
// Usage: npm run bench      (PW_CHANNEL=chrome to use installed Chrome)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';

const port = 4391 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(port)], { stdio: 'ignore' });
const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.PW_CHANNEL) launch.channel = process.env.PW_CHANNEL;
const browser = await chromium.launch(launch);

async function measure(setup, steps, label) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://localhost:${port}/?debug`);
  await page.waitForFunction(() => window.__app, null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(([s, n]) => {
    const app = window.__app;
    new Function('app', s)(app);
    // Browsers coarsen performance.now() (0.1 ms here), so time batches of 50 steps, not single steps.
    const B = 50, batches = [];
    let i = 0, total = 0;
    while (i < n && app.build.state !== 'done') {
      const a = performance.now();
      let k = 0;
      for (; k < B && i < n && app.build.state !== 'done'; k++, i++) app.simStep();
      const dt = performance.now() - a;
      total += dt;
      if (k === B) batches.push(dt / B);
    }
    batches.sort((x, y) => x - y);
    return { steps: i, mean: total / i, p95: batches[Math.floor(0.95 * batches.length)], worst: batches[batches.length - 1], done: app.build.state };
  }, [setup, steps]);
  await page.close();
  return { label, ...r };
}

const rows = [];
rows.push(await measure('', 6000, 'Idle scene, 6 blocks at rest'));
rows.push(await measure("app.actions.selectStructure('pyramid'); app.actions.startBuild();", 60000, 'Auto-Build pyramid (start to finish)'));
rows.push(await measure("app.actions.selectStructure('tower'); app.actions.startBuild();", 90000, 'Auto-Build tower of 6 (start to finish)'));
const version = browser.version();
await browser.close();
server.kill();

const budget = 1000 / 120;
console.log(`\nMachine: ${cpus()[0].model}, ${cpus().length} logical cores, ${(totalmem() / 2 ** 30).toFixed(0)} GB RAM, ${platform()} ${release()}`);
console.log(`Browser: Chromium ${version} (headless), Node ${process.version}`);
console.log(`Real-time budget per step at 120 Hz: ${budget.toFixed(2)} ms\n`);
console.log('| Scenario | Steps | Mean ms/step | p95 ms/step | Worst ms/step |');
console.log('| --- | ---: | ---: | ---: | ---: |');
for (const r of rows) {
  console.log(`| ${r.label} | ${r.steps} | ${r.mean.toFixed(3)} | ${r.p95.toFixed(3)} | ${r.worst.toFixed(3)} |`);
}
console.log(`\nFinal Auto-Build states: ${rows.slice(1).map((r) => r.done).join(', ')}`);
