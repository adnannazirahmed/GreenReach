import { defineConfig } from '@playwright/test';

const port = Number(process.env.GREENREACH_E2E_PORT || 4311);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('GREENREACH_E2E_PORT must be a valid TCP port.');
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: 'e2e.spec.js',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '../../artifacts/playwright',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.js',
    url: `${baseURL}/api/health`,
    env: {
      GREENREACH_E2E_PORT: String(port),
      GREENREACH_E2E_HOST: '127.0.0.1',
    },
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
