import { test, expect } from "@playwright/test";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";

test("browser smoke flows across local, pvp, and katago modes", async ({ page }) => {
  test.setTimeout(120000);

  const boardButtons = page.locator("#board button");
  const boardStones = page.locator("#board .stone");

  async function waitForBoardReady() {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await expect(boardButtons).toHaveCount(81);
    await expect(page.locator("#modeBadge")).not.toHaveText("Preparing board");
  }

  async function clickBoardCell(index) {
    await boardButtons.nth(index).click();
  }

  await test.step("initial page load", async () => {
    await waitForBoardReady();
    await expect(page.locator("#providerBadge")).toContainText("Play:");
  });

  await test.step("local heuristic mode", async () => {
    await page.selectOption("#gameModeSelect", "local");
    await expect(page.locator("#providerBadge")).toContainText("Player vs Local Heuristic");

    await clickBoardCell(0);
    await expect.poll(async () => boardStones.count(), { timeout: 15000 }).toBeGreaterThanOrEqual(2);
    await expect(page.locator("#turnStatus")).toContainText("Your move");

    await page.click("#suggestionButton");
    await expect
      .poll(async () => (await page.locator(".is-recommended").count()) > 0, { timeout: 15000 })
      .toBe(true);

    await page.click("#undoButton");
    await expect.poll(async () => boardStones.count(), { timeout: 10000 }).toBe(0);
  });

  await test.step("player vs player mode", async () => {
    await page.selectOption("#gameModeSelect", "pvp");
    await expect(page.locator("#providerBadge")).toContainText("Player vs Player");

    await clickBoardCell(0);
    await clickBoardCell(10);
    await expect.poll(async () => boardStones.count(), { timeout: 5000 }).toBe(2);

    await page.click("#suggestionButton");
    await expect
      .poll(async () => (await page.locator(".is-recommended").count()) > 0, { timeout: 20000 })
      .toBe(true);

    await page.click("#scoreButton");
    await expect(page.locator("#scoringPanel")).toBeVisible();
    await page.click("#resumePlayButton");
    await expect(page.locator("#scoringPanel")).toBeHidden();
  });

  await test.step("katago mode when available", async () => {
    const katagoAvailable = await page.evaluate(() => {
      const option = document.querySelector('#gameModeSelect option[value="katago"]');
      return Boolean(option && !option.disabled);
    });

    test.skip(!katagoAvailable, "KataGo mode is unavailable in this environment.");

    await page.selectOption("#gameModeSelect", "katago");
    await expect(page.locator("#providerBadge")).toContainText("Player vs KataGo");

    await clickBoardCell(0);
    await expect.poll(async () => boardStones.count(), { timeout: 20000 }).toBeGreaterThanOrEqual(2);
    await expect(page.locator("#turnStatus")).toContainText("Your move");

    await page.click("#suggestionButton");
    await expect
      .poll(async () => (await page.locator(".is-recommended").count()) > 0, { timeout: 20000 })
      .toBe(true);
  });
});
