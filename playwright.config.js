const { defineConfig } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// ponytail: minimal env loader, no dotenv dependency
function loadEnvFiles(root) {
  const files = ['.env.e2e.local', '.env.e2e', '.env'];
  for (const file of files) {
    const fp = path.join(root, file);
    if (!fs.existsSync(fp)) continue;
    const text = fs.readFileSync(fp, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"')))
        val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
}
loadEnvFiles(__dirname);

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const healthUrl = new URL('/api/health', baseUrl).toString();

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 120000,
  use: {
    baseURL: baseUrl,
    channel: 'msedge',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.js',
    reuseExistingServer: false,
    timeout: 120000,
    url: healthUrl,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
