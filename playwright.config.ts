import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the real production build (server serves the built client) in
 * Chromium with a synthetic camera (--use-fake-device-for-media-stream). localhost counts
 * as a secure context, so getUserMedia works without HTTPS here.
 *
 * Run `npm run build` first. Set CHROME_PATH to use a system Chrome instead of
 * Playwright's bundled Chromium (`npx playwright install chromium`).
 */
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    ...devices["Pixel 7"],
    baseURL: `http://localhost:${PORT}`,
    permissions: ["camera"],
    launchOptions: {
      executablePath: process.env.CHROME_PATH || undefined,
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node server/dist/index.js`,
    env: { NODE_ENV: "production", PORT: String(PORT) },
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
