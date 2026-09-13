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
 * starts one. CI: .github/workflows/frontend-tests.yml.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5199",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --port 5199 --strictPort",
    url: "http://localhost:5199/",
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
