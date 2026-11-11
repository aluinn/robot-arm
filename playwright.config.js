import { defineConfig } from '@playwright/test';

const port = Number(process.env.PORT || 4713);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 720 },
    // channel: set PW_CHANNEL=chrome to use an installed Chrome instead of Playwright's Chromium
    channel: process.env.PW_CHANNEL || undefined,
    // software WebGL so it also works on machines without a GPU (CI)
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: `node scripts/serve.mjs ${port}`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,   // never test whatever else happens to be on the port
  },
});
