import { chromium } from "playwright";
import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
// Search panel / tag strip regression (2026-09-25). Synthetic fixtures only.
const base = (process.env.TIEZ_TEST_URL || "http://127.0.0.1:5175").replace(/\/$/, "");
const dir = process.env.TIEZ_TEST_ARTIFACT_DIR || path.join(os.tmpdir(), "tiez-ui-regression");
await fs.mkdir(dir, { recursive: true });
const artifact = (name) => path.join(dir, name);

// TIEZ_PW_CHANNEL=msedge reuses the system Edge when Playwright's Chromium is not installed.
const browser = await chromium.launch(process.env.TIEZ_PW_CHANNEL ? { channel: process.env.TIEZ_PW_CHANNEL } : {});
const results = [];
const pages = [];
async function run(name, fn) {
  try {
    results.push({ name, status: "pass", detail: await fn() });
  } catch (e) {
    results.push({ name, status: "fail", error: e.message });
  } finally {
    for (const page of pages.splice(0)) await page.close();
  }
  console.log(results.at(-1));
}
async function make(query = "savedTags", width = 352, height = 640, media = {}) {
  const p = await browser.newPage({ viewport: { width, height }, ...media });
  pages.push(p);
  p.setDefaultTimeout(5000);
  p.setDefaultNavigationTimeout(30000);
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.goto(base + "/tests/ui/index.html?" + query);
  await expect(p.locator(".history-item").first()).toBeVisible();
  await expect(p.locator(".search-tag-chip").first()).toBeVisible();
  await p.waitForTimeout(600);
  return p;
}
const listTop = (p) => p.locator(".main-content").evaluate((el) => el.getBoundingClientRect().top);
/** Record the list top on every frame while `action` runs. */
async function trackTop(p, action, ms = 450) {
  await p.evaluate(() => {
    window.__tops = [];
    const el = document.querySelector(".main-content");
    const tick = () => {
      window.__tops.push(el.getBoundingClientRect().top);
      if (window.__tracking) requestAnimationFrame(tick);
    };
    window.__tracking = true;
    requestAnimationFrame(tick);
  });
  await action();
  await p.waitForTimeout(ms);
  return p.evaluate(() => { window.__tracking = false; return window.__tops; });
}

await run("strip:shows-saved-zero-count-tags-sorted-by-count", async () => {
  const p = await make();
  const names = await p.locator(".search-tag-chip .search-tag-name").allTextContents();
  const counts = (await p.locator(".search-tag-chip .search-tag-count").allTextContents()).map(Number);
  expect(names).toContain("新建标签甲");
  expect(names).toContain("新建标签乙");
  expect(names.length).toBe(7);
  expect(names[0]).toBe("工作");
  for (let i = 1; i < counts.length; i++) expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i]);
  await p.screenshot({ path: artifact("search-strip-default.png") });
  expect(p.errors).toEqual([]);
  return { names, counts };
});

await run("strip:focus-blur-does-not-move-list", async () => {
  const p = await make();
  const tops = await trackTop(p, async () => {
    await p.locator(".search-input").click();
    await p.waitForTimeout(250);
    await p.locator(".history-item").first().hover();
    await p.locator(".search-input").blur();
  });
  const spread = Math.max(...tops) - Math.min(...tops);
  expect(spread).toBeLessThan(0.5);
  return { frames: tops.length, spread };
});

await run("strip:click-filters-and-toggles-off", async () => {
  const p = await make();
  const chip = p.locator('.search-tag-chip[data-tag="标签A"]');
  await chip.click();
  await expect(p.locator(".search-input")).toHaveValue("tag:标签A");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(chip.locator(".search-tag-active-ring")).toBeVisible();
  await expect(p.locator(".history-item")).toHaveCount(1, { timeout: 4000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: artifact("search-strip-active.png") });
  const other = p.locator('.search-tag-chip[data-tag="工作"]');
  await other.click();
  await expect(p.locator(".search-input")).toHaveValue("tag:工作");
  await expect(p.locator(".search-tag-active-ring")).toHaveCount(1);
  await other.click();
  await expect(p.locator(".search-input")).toHaveValue("");
  await expect(p.locator(".search-tag-active-ring")).toHaveCount(0);
  return "ok";
});

await run("panel:clear-button-and-toggle-without-height-jank", async () => {
  const p = await make();
  await p.locator(".search-input").fill("审核");
  await p.locator(".search-clear-btn").click();
  await expect(p.locator(".search-input")).toHaveValue("");
  const btn = p.locator(".header-actions .btn-icon").nth(1);
  const before = await listTop(p);
  const tops = await trackTop(p, () => btn.click(), 400);
  await expect(p.locator(".search-panel")).not.toHaveClass(/open/);
  const inert = await p.locator(".search-panel").evaluate((el) => el.inert);
  expect(inert).toBe(true);
  const after = await listTop(p);
  expect(after).toBeLessThan(before);
  // Monotonic collapse: never bounces back up while closing.
  for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeLessThanOrEqual(tops[i - 1] + 0.5);
  await btn.click();
  await expect(p.locator(".search-panel")).toHaveClass(/open/);
  await expect(p.locator(".search-input")).toBeFocused();
  return { before, after, frames: tops.length };
});

await run("strip:empty-state-and-dark-theme", async () => {
  const p = await make("savedTags", 352, 640, { colorScheme: "dark" });
  await p.screenshot({ path: artifact("search-strip-dark.png") });
  expect(p.errors).toEqual([]);
  return "ok";
});

const panelOpen = (p) => p.locator(".search-panel").evaluate((el) => el.classList.contains("open"));
const altF = (p, wasHidden = false) =>
  p.evaluate((h) => window.__audit.emit("focus-search-input", { wasHidden: h }), wasHidden);

await run("chip:dark-text-readable", async () => {
  const p = await make();
  const colors = await p.locator(".search-tag-chip").evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).color));
  for (const c of colors) expect(c).toBe("rgb(26, 26, 26)");
  await p.screenshot({ path: artifact("search-strip-dark-text.png"), clip: { x: 0, y: 0, width: 352, height: 200 } });
  return { chips: colors.length };
});

await run("hotkey:alt-f-toggles-even-with-tag-selected", async () => {
  const p = await make();
  const all = await p.locator(".history-item").count();
  await p.locator('.search-tag-chip[data-tag="标签A"]').click();
  await expect(p.locator(".history-item")).toHaveCount(1, { timeout: 4000 });
  await altF(p);
  await expect.poll(() => panelOpen(p)).toBe(false);
  await expect(p.locator(".search-input")).toHaveValue("");
  await expect(p.locator(".history-item")).toHaveCount(all, { timeout: 4000 });
  await altF(p);
  await expect.poll(() => panelOpen(p)).toBe(true);
  await expect(p.locator(".search-input")).toBeFocused();
  await altF(p);
  await expect.poll(() => panelOpen(p)).toBe(false);
  expect(p.errors).toEqual([]);
  return { all };
});

await run("hotkey:summon-hidden-window-keeps-open", async () => {
  const p = await make();
  expect(await panelOpen(p)).toBe(true);
  await altF(p, true);
  await p.waitForTimeout(200);
  expect(await panelOpen(p)).toBe(true);
  await expect(p.locator(".search-input")).toBeFocused();
  return "ok";
});

await run("header:search-button-closes-with-tag-selected", async () => {
  const p = await make();
  await p.locator('.search-tag-chip[data-tag="工作"]').click();
  await expect(p.locator(".search-input")).toHaveValue("tag:工作");
  const btn = p.locator('.header-actions .btn-icon[aria-pressed]');
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await btn.click();
  await expect.poll(() => panelOpen(p)).toBe(false);
  await expect(p.locator(".search-input")).toHaveValue("");
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await btn.click();
  await expect.poll(() => panelOpen(p)).toBe(true);
  return "ok";
});

await browser.close();
await fs.writeFile(artifact("search-strip-results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.status === "fail");
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
