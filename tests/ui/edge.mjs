import { chromium } from "playwright";
import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const base = (process.env.TIEZ_TEST_URL || "http://127.0.0.1:5175").replace(
  /\/$/,
  "",
);
const dir =
  process.env.TIEZ_TEST_ARTIFACT_DIR ||
  path.join(os.tmpdir(), "tiez-ui-regression");
await fs.mkdir(dir, { recursive: true });
const artifact = (name) => path.join(dir, name);

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
async function make(width = 352, height = 640, query = "") {
  const p = await browser.newPage({ viewport: { width, height } });
  pages.push(p);
  p.setDefaultTimeout(5000);
  p.setDefaultNavigationTimeout(30000);
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.goto(base + "/tests/ui/index.html?" + query);
  await expect(p.locator(".history-item").first()).toBeVisible();
  return p;
}
async function tags(p) {
  await p.getByTitle("标签管理", { exact: true }).click();
  await expect(p.locator(".selected-tag-indicator")).toBeVisible();
}
async function favorites(p) {
  await p.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(p.locator(".favorite-item").first()).toBeVisible();
}
async function bounds(p) {
  const r = await p.locator(".favorite-popover").boundingBox();
  expect(r).not.toBeNull();
  const v = p.viewportSize();
  expect(r.x).toBeGreaterThanOrEqual(7);
  expect(r.y).toBeGreaterThanOrEqual(7);
  expect(r.x + r.width).toBeLessThanOrEqual(v.width - 7);
  expect(r.y + r.height).toBeLessThanOrEqual(v.height - 7);
  return r;
}
await run("race:old-error-must-not-clear-new-loading", async () => {
  const p = await make();
  await tags(p);
  await p.evaluate(() => {
    window.__audit.wait["get_tag_items:标签A"] = 100;
    window.__audit.fail["get_tag_items:标签A"] = true;
    window.__audit.wait["get_tag_items:标签B"] = 700;
  });
  await p.locator(".tag-item").filter({ hasText: "标签A" }).click();
  await p.locator(".tag-item").filter({ hasText: "标签B" }).click();
  await p.waitForTimeout(250);
  const status = await p.locator(".status-msg").innerText();
  expect(status).toMatch(/处理|Processing/);
  await expect(
    p.getByText("只属于标签 B 的内容", { exact: true }),
  ).toBeVisible();
  expect(p.errors).toEqual([]);
});
await run("race:batch-selection-reset-on-tag-switch", async () => {
  const p = await make();
  await tags(p);
  await p.getByTitle("管理条目").click();
  await p.locator(".themed-card").first().click();
  await expect(p.locator(".batch-selection-count")).toContainText("1");
  await p.locator(".tag-item").filter({ hasText: "标签B" }).click();
  await expect(p.locator(".batch-toolbar")).toHaveCount(0);
  await p.getByTitle("管理条目").click();
  await expect(p.locator(".batch-selection-count")).toContainText("0");
  await expect(
    p.getByRole("button", { name: "删除选中", exact: true }),
  ).toBeDisabled();
});
await run("race:unmount-while-loading", async () => {
  const p = await make();
  await tags(p);
  await p.evaluate(() => (window.__audit.wait["get_tag_items:标签A"] = 400));
  await p.locator(".tag-item").filter({ hasText: "标签A" }).click();
  await p.locator(".header-leading > button").click();
  await p.waitForTimeout(600);
  await expect(p.locator(".history-item").first()).toBeVisible();
  expect(p.errors).toEqual([]);
});
for (const theme of [
  "mica",
  "acrylic",
  "retro",
  "sticky-note",
  "paper",
  "sakura",
])
  await run("header:250:" + theme, async () => {
    const p = await make(250, 300, "theme=" + theme);
    const rs = await p
      .locator(".header-actions button")
      .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().toJSON()));
    for (const r of rs) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(250);
    }
    await expect(p.locator(".header-title")).toHaveText("落笺");
  });
for (const [width, height] of [
  [352, 380],
  [250, 300],
])
  await run(`tags:short-expand-select-batch:${width}x${height}`, async () => {
    const p = await make(width, height);
    await tags(p);
    await expect(p.locator(".themed-tag-manager")).toHaveClass(
      /sidebar-collapsed/,
    );
    expect(
      (await p.locator(".items-area").boundingBox()).height,
    ).toBeGreaterThanOrEqual(100);
    await p.locator(".collapse-toggle").click();
    await expect(p.getByPlaceholder("查找或创建...")).toBeVisible();
    await p.locator(".tag-item").filter({ hasText: "标签B" }).click();
    await expect(p.locator(".themed-tag-manager")).toHaveClass(
      /sidebar-collapsed/,
    );
    await expect(
      p.getByText("只属于标签 B 的内容", { exact: true }),
    ).toBeVisible();
    await p.getByTitle("管理条目").click();
    await p.locator(".themed-card").first().click();
    await expect(p.locator(".batch-selection-count")).toContainText("1");
    await expect(
      p.getByRole("button", { name: "取消", exact: true }),
    ).toBeVisible();
    await p.getByRole("button", { name: "取消", exact: true }).click();
    await p.screenshot({ path: artifact(`short-${width}x${height}.png`) });
  });
for (const mode of ["light", "dark"])
  await run("favorites:edge-portals:" + mode, async () => {
    const p = await make(250, 300, "mode=" + mode);
    await favorites(p);
    const card = p.locator(".favorite-item").first();
    await card.scrollIntoViewIfNeeded();
    const r = await card.boundingBox();
    await card.click({
      button: "right",
      position: { x: r.width - 10, y: r.height - 10 },
    });
    await bounds(p);
    expect(
      await p
        .locator(".favorite-popover")
        .evaluate((e) => e.parentElement === document.body),
    ).toBe(true);
    await p.screenshot({ path: artifact(`menu-edge-${mode}.png`) });
    await p.keyboard.press("Escape");
    await expect(p.locator(".favorite-popover")).toHaveCount(0);
    await p.getByTitle("移动到分组", { exact: true }).first().click();
    await bounds(p);
    await p
      .locator(".favorite-popover button")
      .filter({ hasText: "代码" })
      .click();
    await expect(p.locator(".favorite-item")).toHaveCount(2);
    expect(
      await p.evaluate(
        () =>
          window.__audit.calls.filter((c) => c.cmd === "paste_favorite").length,
      ),
    ).toBe(0);
  });
await run("favorites:folder-menu-scroll-and-resize", async () => {
  const p = await make();
  await favorites(p);
  await p.locator(".favorite-folder-tab").nth(1).click({ button: "right" });
  await bounds(p);
  await p.locator(".favorite-folders").evaluate((e) => (e.scrollLeft = 100));
  await expect(p.locator(".favorite-popover")).toHaveCount(0);
  await p.getByTitle("移动到分组", { exact: true }).first().click();
  await bounds(p);
  await p.setViewportSize({ width: 250, height: 380 });
  await expect(p.locator(".favorite-popover")).toHaveCount(0);
});
await run("favorites:long-folder-list-scroll-does-not-close", async () => {
  const p = await make(250, 300, "manyFolders=1");
  await favorites(p);
  await p.getByTitle("移动到分组", { exact: true }).first().click();
  await bounds(p);
  await p
    .locator(".favorite-popover")
    .evaluate((e) => (e.scrollTop = e.scrollHeight));
  await p.waitForTimeout(100);
  await expect(p.locator(".favorite-popover")).toBeVisible();
  expect(
    await p.locator(".favorite-popover").evaluate((e) => e.scrollTop > 0),
  ).toBe(true);
  await bounds(p);
});
await run("main:compact-smoke", async () => {
  const p = await make(250, 380, "compact=true");
  await expect(p.locator(".history-item.compact").first()).toBeVisible();
  expect(p.errors).toEqual([]);
  await p.screenshot({ path: artifact("main-compact-250.png") });
});
await fs.writeFile(
  artifact("edge-results.json"),
  JSON.stringify(results, null, 2),
);
await browser.close();
if (results.some((r) => r.status === "fail")) process.exitCode = 1;
