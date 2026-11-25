import { defineConfig, devices } from "@playwright/test";

const PORT = 4318;

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 30_000,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, timezoneId: "America/Vancouver" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `rm -rf .e2e-data && vite build && GSD_PASSWORD=test-password GSD_DATA_DIR=.e2e-data GSD_WEB_DIR=dist PORT=${PORT} tsx ../server/src/main.ts`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
