import { test, expect } from "@playwright/test";

/**
 * Phone-width layout guard (375×812, light theme, the production look).
 *
 * The first test is the one that would have caught the September 2026
 * This Week regression: every score box must sit inside its day card,
 * and no row may collapse its team columns to 0px. The second is the
 * cheap general rule that no route scrolls sideways.
 *
 * Routes are discovered from the live dashboard rather than hardcoded,
 * because game and team ids change every week of the season.
 */

const DASHBOARD = "/?theme=light#/football";

async function waitForDashboard(page) {
  await page.goto(DASHBOARD);
  await page.locator(".section-tabs").first().waitFor({ timeout: 30_000 });
}

/** Horizontal containment of every `item` inside its closest `container`. */
async function horizontalFit(page, item, container) {
  return page.evaluate(
    ([itemSel, containerSel]) => {
      const out = [];
      for (const el of document.querySelectorAll(itemSel)) {
        const box = el.closest(containerSel);
        if (!box) continue;
        const a = el.getBoundingClientRect();
        if (a.width === 0 && a.height === 0) continue;
        const b = box.getBoundingClientRect();
        out.push({
          text: el.textContent.trim(),
          row: el.closest(".game-row")?.textContent.trim().slice(0, 70) ?? null,
          right: Math.round(a.right),
          limit: Math.round(b.right),
          inside: a.left >= b.left - 0.5 && a.right <= b.right + 0.5,
        });
      }
      return out;
    },
    [item, container],
  );
}

async function pageOverflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test.describe("phone layout guard", () => {
  test("every This Week score is on screen inside its day card", async ({ page }) => {
    await waitForDashboard(page);
    const rowCount = await page.locator(".game-row").count();
    test.skip(rowCount === 0, "no This Week rows in the current dataset (off-season or preseason)");

    const collapsed = await page.evaluate(() =>
      [...document.querySelectorAll(".game-row")]
        .filter((r) => getComputedStyle(r).gridTemplateColumns.split(" ").includes("0px"))
        .map((r) => r.textContent.trim().slice(0, 70)),
    );
    expect(collapsed, "rows whose team columns computed to 0px").toEqual([]);

    const scores = await horizontalFit(page, ".game-side__score", ".week-day");
    expect(scores.length, "no score boxes found in the week grid").toBeGreaterThan(0);
    expect(
      scores.filter((s) => !s.inside),
      "scores rendered outside their day card",
    ).toEqual([]);
  });

  test("the Earlier Results rail pages with the arrow keys from the keyboard", async ({ page }) => {
    await waitForDashboard(page);
    const track = page.locator(".ticker__track");
    test.skip((await track.count()) === 0, "no Earlier Results rail in the current dataset");
    await expect(track).toHaveAttribute("role", "region");
    await expect(track).toHaveAttribute("tabindex", "0");
    await track.focus();
    await expect(track).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => track.evaluate((el) => Math.round(el.scrollLeft)), { timeout: 5_000 })
      .toBeGreaterThan(100);
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(() => track.evaluate((el) => Math.round(el.scrollLeft)), { timeout: 5_000 })
      .toBeLessThan(20);
  });

  test("dashboard, a game page and a team page never scroll sideways", async ({ page }) => {
    await waitForDashboard(page);
    const dash = await pageOverflow(page);
    expect(dash.scrollWidth, "dashboard scrolls horizontally").toBeLessThanOrEqual(dash.clientWidth);

    // Discover one game and one team from the page itself.
    const gameHref = await page.locator("a.game-row__details, a.card__details").first().getAttribute("href");
    const teamHref = await page.locator("a.team-link").first().getAttribute("href");

    for (const [label, href] of [
      ["game page", gameHref],
      ["team page", teamHref],
    ]) {
      if (!href) continue;
      await page.goto(`/?theme=light${href}`);
      await page.locator("main").waitFor();
      await page.waitForTimeout(500);
      const o = await pageOverflow(page);
      expect(o.scrollWidth, `${label} scrolls horizontally`).toBeLessThanOrEqual(o.clientWidth);
    }
  });
});
