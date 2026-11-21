import { test, expect } from "@playwright/test";
import { landingSport } from "../src/utils/inSeason.js";

/**
 * Team calendar subscriptions (components/CalendarButton.jsx, feeds from
 * scraper/scripts/build_calendars.py). A broken link here fails silently
 * for the reader: their calendar app just shows an error or an empty
 * calendar. So: the panel opens, each destination points at the team's
 * feed, the feed itself is served as a calendar, and the open panel never
 * pushes the page sideways on a phone.
 */

const SPORT = landingSport();

test("team page subscribes a calendar to that team's feed", async ({ page }) => {
  await page.goto(`/?theme=light#/${SPORT}`);
  await page.locator(".section-tabs").first().waitFor({ timeout: 30_000 });
  const teamHref = await page.locator("a.team-link").first().getAttribute("href");
  test.skip(!teamHref, "no team links on the dashboard");
  const schoolId = /\/team\/([^/?#]+)/.exec(teamHref)?.[1];

  await page.goto(`/?theme=light${teamHref}`);
  const toggle = page.getByRole("button", { name: "Add to calendar" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const panel = page.locator(".cal-panel");
  const apple = await panel.getByRole("link", { name: "iPhone or Mac" }).getAttribute("href");
  expect(apple).toMatch(new RegExp(`^webcal://.+/data/calendar/${schoolId}/${SPORT}\\.ics$`));
  const google = await panel.getByRole("link", { name: "Google Calendar" }).getAttribute("href");
  expect(decodeURIComponent(google)).toContain(apple);
  const outlook = await panel.getByRole("link", { name: "Outlook" }).getAttribute("href");
  expect(decodeURIComponent(outlook)).toContain(`/data/calendar/${schoolId}/${SPORT}.ics`);

  // The school-wide scope swaps every link to all.ics.
  await panel.getByRole("radio", { name: /Every .+ sport/ }).check();
  await expect(panel.getByRole("link", { name: "iPhone or Mac" })).toHaveAttribute(
    "href",
    new RegExp(`/data/calendar/${schoolId}/all\\.ics$`),
  );

  // The feed the links point at exists and is a calendar.
  const feed = await page.request.get(apple.replace(/^webcal:/, "http:"));
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  expect((await feed.text()).startsWith("BEGIN:VCALENDAR")).toBe(true);

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, "open calendar panel widens the page").toBeLessThanOrEqual(375);
});
