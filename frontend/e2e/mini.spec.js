import { test, expect } from "@playwright/test";
import { MINI_HEIGHTS } from "../src/mini/embed.js";

/**
 * Mini scoreboard guard (mini.html).
 *
 * The homepage embed can't auto-resize, so the height in the published
 * snippet is a promise: nothing may ever render below it. These tests feed
 * the mini a worst-case slate — every slot full, the longest names in the
 * data, a live game, a sold sponsor — through route interception, then
 * check the module fits inside MINI_HEIGHTS at sidebar and column widths.
 * Selection rules (live first, forfeits out, one appearance per school
 * before repeats, every tap to the hub page) are checked on the same slate.
 */

const HUB = "https://wausaupilotandreview.com/high-school-sports/";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Central-time ISO string `offsetMs` from now. */
function isoFromNow(offsetMs) {
  const d = new Date(Date.now() + offsetMs - 5 * HOUR);
  return `${d.toISOString().slice(0, 19)}-05:00`;
}

function side(school_id, name, score = null) {
  return { school_id, name, score, logo_url: null };
}

function game(id, offsetMs, status, away, home, extra = {}) {
  return { id, sport: "football", date: isoFromNow(offsetMs), status, conference_game: true, playoff: false, away, home, ...extra };
}

function worstCaseFeed() {
  return {
    sport: "football",
    generated_at: new Date().toISOString(),
    window_days: { past: 10, future: 14 },
    games: [
      // A forfeit (WIAA 2-0) between the two most local schools: must not show.
      game("forfeit", -1 * DAY, "final", side("wausau-west", "Wausau West", 2), side("wausau-east", "Wausau East", 0)),
      // Four matches for one school: only one may show while others wait.
      game("east-1", -1 * DAY, "final", side("wausau-east", "Wausau East", 27), side(null, "Hayward/Lac Courte Oreilles", 22)),
      game("east-2", -1 * DAY - HOUR, "final", side("wausau-east", "Wausau East", 14), side(null, "Wisconsin Rapids Lincoln", 13)),
      game("east-3", -1 * DAY - 2 * HOUR, "final", side("wausau-east", "Wausau East", 7), side(null, "Northland Lutheran/Wausau Newman", 6)),
      game("dce", -2 * DAY, "final", side("dc-everest", "D.C. Everest", 10), side("marshfield", "Marshfield", 9)),
      game("mosinee", -2 * DAY, "final", side("mosinee", "Mosinee", 21), side(null, "Wittenberg-Birnamwood Consolidated", 20)),
      game("live", -HOUR, "in_progress", side("merrill", "Merrill", 14), side(null, "Eau Claire Memorial Old Abes", 10)),
      game("next-1", 2 * DAY, "scheduled", side(null, "Hayward/Lac Courte Oreilles", null), side("wausau-east", "Wausau East", null)),
      game("next-2", 3 * DAY, "scheduled", side(null, "Northland Lutheran/Wausau Newman", null), side("dc-everest", "D.C. Everest", null)),
      game("next-3", 4 * DAY, "scheduled", side(null, "Wittenberg-Birnamwood Consolidated", null), side("mosinee", "Mosinee", null)),
    ],
  };
}

const SOLD_SPONSORS = {
  slots: {
    mini: {
      label: "Scoreboard presented by",
      name: "A Very Long Regional Sponsor Name Inc.",
      logo_url: null,
      link_url: "https://example.com/",
    },
  },
};

async function baseOf(page) {
  // Dev serves under /wpr-prep-sports/ locally and / in CI (VITE_BASE).
  await page.goto("/");
  return new URL(page.url()).pathname.replace(/[^/]*$/, "");
}

async function openMini(page, query, { width, height }) {
  await page.setViewportSize({ width, height });
  await page.route("**/data/football/mini.json*", (route) => route.fulfill({ json: worstCaseFeed() }));
  await page.route("**/data/sponsors.json*", (route) => route.fulfill({ json: SOLD_SPONSORS }));
  const base = await baseOf(page);
  await page.goto(`${base}mini.html?${query}`);
  await page.locator(".mini-game").first().waitFor({ timeout: 30_000 });
}

async function miniBox(page) {
  return page.evaluate(() => {
    const r = document.querySelector(".mini").getBoundingClientRect();
    return {
      bottom: Math.ceil(r.bottom),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
}

test.describe("mini scoreboard", () => {
  for (const [mode, query] of [
    ["single", "sport=football"],
    ["switcher", "sports=football,volleyball,boys_soccer,girls_soccer"],
  ]) {
    for (const width of [300, 360, 420]) {
      test(`${mode} mini fits its published height at ${width}px`, async ({ page }) => {
        const height = MINI_HEIGHTS[mode];
        await openMini(page, query, { width, height });
        const box = await miniBox(page);
        expect(box.bottom, `mini is ${box.bottom}px tall in a ${height}px frame`).toBeLessThanOrEqual(height);
        expect(box.scrollWidth, "mini scrolls sideways").toBeLessThanOrEqual(box.clientWidth);
      });
    }
  }

  test("worst-case slate: live first, forfeit out, schools spread, taps go to the hub", async ({ page }) => {
    await openMini(page, "sport=football", { width: 360, height: MINI_HEIGHTS.single });

    const cards = await page.locator(".mini-game").evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label")),
    );
    expect(cards).toHaveLength(4);
    expect(cards[0], "the live game leads").toMatch(/^Merrill 14, .* in progress$/);
    expect(cards.join(" | "), "the forfeit never shows").not.toMatch(/Wausau West 2/);
    const eastCount = cards.filter((c) => c.includes("Wausau East")).length;
    expect(eastCount, "one school may not take several slots while others wait").toBe(1);

    await expect(page.locator(".mini-next")).toHaveCount(3);

    const links = await page.locator(".mini a").evaluateAll((els) =>
      els.map((a) => ({ href: a.getAttribute("href"), target: a.getAttribute("target"), sponsored: (a.rel || "").includes("sponsored") })),
    );
    for (const l of links.filter((x) => !x.sponsored)) {
      expect(l).toEqual({ href: HUB, target: "_top", sponsored: false });
    }
    expect(links.some((l) => l.sponsored), "sold sponsor renders its link").toBe(true);
  });

  test("switcher changes sport, marks the pressed button, and remembers it", async ({ page }) => {
    await openMini(page, "sports=football,volleyball", { width: 360, height: MINI_HEIGHTS.switcher });
    const volleyball = page.getByRole("button", { name: "Volleyball" });
    await expect(page.getByRole("button", { name: "Football" })).toHaveAttribute("aria-pressed", "true");
    await volleyball.click();
    await expect(volleyball).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".mini")).toHaveAttribute("data-sport", "volleyball");
    await page.reload();
    await expect(page.getByRole("button", { name: "Volleyball" })).toHaveAttribute("aria-pressed", "true");
  });
});
