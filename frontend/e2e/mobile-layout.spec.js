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
  test("every This Week team and score is on screen inside its day card", async ({ page }) => {
    await waitForDashboard(page);
    const rowCount = await page.locator(".game-row").count();
    test.skip(rowCount === 0, "no This Week rows in the current dataset (off-season or preseason)");

    const collapsed = await page.evaluate(() =>
      [...document.querySelectorAll(".game-row")]
        .filter((r) => getComputedStyle(r).gridTemplateColumns.split(" ").includes("0px"))
        .map((r) => r.textContent.trim().slice(0, 70)),
    );
    expect(collapsed, "rows whose team columns computed to 0px").toEqual([]);

    // Each team block (logo, name, and the score once there is one) must sit
    // inside its day card. Measured on the block, not the score: early in
    // the week every game is still scheduled and no score boxes exist yet
    // (2026-09-15 — the score-only check found nothing to measure).
    const sides = await horizontalFit(page, ".game-side", ".week-day");
    expect(sides.length, "no team blocks found in the week grid").toBeGreaterThan(0);
    expect(
      sides.filter((s) => !s.inside),
      "team names or scores rendered outside their day card",
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

  test("every section tab label fits its tab at phone width", async ({ page }) => {
    await waitForDashboard(page);
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll(".section-tabs__label")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent.trim()),
    );
    expect(overflowing, "tab labels wider than their tab").toEqual([]);
    const strip = await page.evaluate(() => {
      const el = document.querySelector(".section-tabs");
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, tabs: el.querySelectorAll('[role="tab"]').length };
    });
    expect(strip.tabs).toBeGreaterThanOrEqual(2);
    expect(strip.scrollWidth, "tab strip scrolls sideways").toBeLessThanOrEqual(strip.clientWidth + 1);
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

/**
 * Standings tab at phone width. At 375px the Details chevron is visually
 * hidden (the whole row is the tap target), so a reader needs the
 * "Tap a team" hint under the table instead; and the table itself must
 * stay inside its 350px wrap rather than scrolling off the right edge
 * (critique run 17 measured 372–401px before the column diet).
 */
test.describe("standings at phone width", () => {
  test("rows advertise that they expand, and the table fits", async ({ page }) => {
    await page.goto("/?theme=light#/football?tab=standings");
    await page.locator(".section-tabs").first().waitFor({ timeout: 30_000 });
    const tables = page.locator(".standings__table");
    test.skip((await tables.count()) === 0, "no standings tables in the current dataset");

    const measured = await page.evaluate(() => {
      const bigEnough = (el) => {
        const r = el.getBoundingClientRect();
        return r.width >= 24 && r.height >= 24;
      };
      const visible = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
      };
      return [...document.querySelectorAll(".standings")].map((section) => ({
        conference: section.querySelector(".standings__header h3")?.textContent.trim() ?? "?",
        toggles: section.querySelectorAll(".standings__toggle").length,
        allTogglesTappable: [...section.querySelectorAll(".standings__toggle")].every(bigEnough),
        hintVisible: visible(section.querySelector(".standings__tap-hint")),
        tableWidth: Math.round(section.querySelector(".standings__table").getBoundingClientRect().width),
      }));
    });
    expect(measured.length).toBeGreaterThan(0);
    for (const t of measured) {
      expect(
        t.allTogglesTappable || t.hintVisible,
        `${t.conference}: details toggles under 24px and no "Tap a team" hint shown`,
      ).toBe(true);
      expect(t.tableWidth, `${t.conference}: standings table wider than its wrap`).toBeLessThanOrEqual(350);
    }
  });
});
