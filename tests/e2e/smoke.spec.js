import { test, expect } from '@playwright/test';

// Loads the real app (Three.js and cannon-es come from the CDN, so this needs network access).
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?debug');
  await page.waitForFunction(() => window.__app, null, { timeout: 30_000 });
});

test('loads with a canvas, the panels and six blocks', async ({ page }) => {
  await expect(page.locator('canvas#view')).toBeVisible();
  await expect(page.getByText('Recorder', { exact: true })).toBeVisible();
  await expect(page.getByText('Auto-Build', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => window.__app.physics.blocks.length)).toBe(6);
});

test('keyboard moves the gripper target', async ({ page }) => {
  const before = await page.evaluate(() => JSON.stringify(window.__app.arm.capture().target));
  await page.keyboard.down('w');
  await page.waitForTimeout(600);
  await page.keyboard.up('w');
  const after = await page.evaluate(() => JSON.stringify(window.__app.arm.capture().target));
  expect(after).not.toBe(before);
});

test('Auto-Build stacks all six blocks into a pyramid', async ({ page }) => {
  const result = await page.evaluate(() => {
    const app = window.__app;
    app.actions.selectStructure('pyramid');
    app.actions.startBuild();
    // advance the fixed-step simulation directly instead of waiting about 66 s of real time
    for (let i = 0; i < 40_000 && app.build.running; i++) app.simStep();
    return { state: app.build.state, filled: app.build.filled.filter(Boolean).length, message: app.build.message };
  });
  expect(result.message).toBe('Build complete');
  expect(result.state).toBe('done');
  expect(result.filled).toBe(6);
});

test('a recording replays to the same end state', async ({ page }) => {
  const result = await page.evaluate(() => {
    const app = window.__app;
    app.actions.record();
    for (let i = 0; i < 240; i++) app.simStep();
    app.actions.record();                          // stop and save
    app.actions.autopilot();                       // start the replay
    for (let i = 0; i < 400 && app.rec.replaying; i++) app.simStep();
    return { recorded: app.rec.hasData, result: app.rec.result };
  });
  expect(result.recorded).toBe(true);
  expect(result.result?.ok).toBe(true);
});
