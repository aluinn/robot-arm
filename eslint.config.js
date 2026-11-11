import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'dist/', 'docs/assets/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  { rules: { 'no-unused-vars': ['error', { caughtErrors: 'none' }] } },
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.js', 'tests/**/*.mjs', 'eslint.config.js', 'playwright.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // page.evaluate callbacks run in the browser
    files: ['scripts/screenshots.mjs', 'scripts/bench.mjs', 'tests/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
