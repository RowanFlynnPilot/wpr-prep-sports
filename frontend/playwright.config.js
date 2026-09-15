import { defineConfig, devices } from "@playwright/test";

/**
 * Browser layout guard. Data correctness has three automated gates
 * (validate_data, the sentinel, the scraper suite); until September 2026
 * visual correctness had none, and the This Week grid shipped for six
 * days with scores clipped off-screen at phone width while every gate
 * stayed green. These tests drive the real dev server against the
 * repo's committed data/ at 375px and assert the numbers a reader came
 * for are actually on screen.
 *
 * Local: `npm run test:e2e` reuses a dev server already on :5199 or
 * starts one. Set E2E_PORT when 5199 belongs to something else: the guard
 * reuses whatever answers on the port, so another project's dev server
 * there would be tested in this app's place. CI:
 * .github/workflows/frontend-tests.yml.
 */
const PORT = Number(process.env.E2E_PORT) || 5199;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 90_000,
  },
  projects: [
    {
      // A real phone profile: touch, coarse pointer, mobile UA — so the
      // `(hover: none) and (pointer: coarse)` styles apply as they do
      // for the parent reading in the bleachers.
      name: "phone",
      use: { ...devices["Pixel 5"], viewport: { width: 375, height: 812 } },
    },
  ],
});
