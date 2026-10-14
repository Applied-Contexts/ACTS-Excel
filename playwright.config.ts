import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: '**/*.spec.ts', use: { headless: true, viewport: { width: 880, height: 700 } }, reporter: 'list' });
