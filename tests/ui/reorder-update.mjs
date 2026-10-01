import { chromium } from "playwright";
import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
// Long-press drag reordering + update checker (2026-09-28). Synthetic fixtures only, no network.
const base = (process.env.TIEZ_TEST_URL || "http://127.0.0.1:5175").replace(/\/$/, "");
const dir = process.env.TIEZ_TEST_ARTIFACT_DIR || path.join(os.tmpdir(), "tiez-ui-regression");
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
async function make(query = "savedTags", width = 420, height = 640) {
  const p = await browser.newPage({ viewport: { width, height } });
  pages.push(p);
  p.setDefaultTimeout(5000);
  p.setDefaultNavigationTimeout(30000);
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.goto(base + "/tests/ui/index.html?" + query);
  await expect(p.locator(".history-item").first()).toBeVisible();
  await p.waitForTimeout(500);
  return p;
}
// Warm up: the first vite load compiles the app and can exceed the normal timeout.
{
  const warm = await browser.newPage();
  await warm.goto(base + "/tests/ui/index.html?savedTags", { timeout: 120000 });
  await warm.locator(".history-item").first().waitFor({ timeout: 120000 });
  await warm.close();
}
const ids = (p, sel) => p.$$eval(sel, (els) => els.map((e) => e.getAttribute("data-reorder-id")));
const headerIds = (p) => ids(p, ".header-actions [data-reorder-id]");
const tabIds = (p) => ids(p, ".category-tabs [data-reorder-id]");
const tagIds = (p) => ids(p, ".search-tag-strip [data-reorder-id]");
const setting = (p, key) => p.evaluate((k) => window.__audit.settings[k], key);
const calls = (p, cmd) => p.evaluate((c) => window.__audit.calls.filter((x) => x.cmd === c).map((x) => x.args), cmd);

/** Press-and-hold `source`, then drag it onto the left edge of `target`. */
async function longDrag(p, source, target, { hold = 650, edge = "left" } = {}) {
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  const sx = s.x + s.width / 2;
  const sy = s.y + s.height / 2;
  const tx = edge === "left" ? t.x + 3 : t.x + t.width - 3;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  await p.waitForTimeout(hold);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await p.mouse.move(sx + ((tx - sx) * i) / steps, sy);
    await p.waitForTimeout(16);
  }
  await p.waitForTimeout(80);
  await p.mouse.up();
  await p.waitForTimeout(250);
}

await run("header:long-press-drag-reorders-and-persists", async () => {
  const p = await make();
  const before = await headerIds(p);
  expect(before.slice(0, 6)).toEqual(["pin", "search", "clear", "tags", "emoji", "settings"]);
  const btn = p.locator('.header-actions [data-reorder-id="settings"]');
  await longDrag(p, btn, p.locator('.header-actions [data-reorder-id="pin"]'));
  const after = await headerIds(p);
  expect(after[0]).toBe("settings");
  expect(JSON.parse(await setting(p, "app.header_button_order"))[0]).toBe("settings");
  // The click after the drag must not open settings.
  await expect(p.locator('.header-actions [data-reorder-id="search"]')).toBeVisible();
  // Hide button stays last and is not draggable.
  const lastTitle = await p.locator(".header-actions > button").last().getAttribute("title");
  expect(lastTitle).toBe("隐藏");
  return after;
});

await run("header:short-click-still-works", async () => {
  const p = await make();
  await p.locator('.header-actions [data-reorder-id="settings"]').click();
  await expect(p.locator('.header-actions [data-reorder-id="search"]')).toHaveCount(0);
  await expect(p.locator(".settings-group").first()).toBeVisible();
  return "ok";
});

await run("header:move-without-hold-does-not-reorder", async () => {
  const p = await make();
  const before = await headerIds(p);
  await longDrag(p, p.locator('.header-actions [data-reorder-id="emoji"]'), p.locator('.header-actions [data-reorder-id="pin"]'), { hold: 0 });
  expect(await headerIds(p)).toEqual(before);
  expect(await setting(p, "app.header_button_order")).toBeUndefined();
  return "ok";
});

await run("tabs:long-press-drag-reorders-without-switching-tab", async () => {
  const p = await make();
  const before = await tabIds(p);
  expect(before).toEqual(["default", "pinned", "text", "rich_text", "image", "file", "paths"]);
  await longDrag(p, p.locator('.category-tabs [data-reorder-id="image"]'), p.locator('.category-tabs [data-reorder-id="default"]'));
  const after = await tabIds(p);
  expect(after[0]).toBe("image");
  expect(JSON.parse(await setting(p, "app.category_tab_order"))[0]).toBe("image");
  // Drag must not activate the tab.
  await expect(p.locator('.category-tabs [data-reorder-id="default"]')).toHaveClass(/active/);
  // Normal click still switches.
  await p.locator('.category-tabs [data-reorder-id="text"]').click();
  await expect(p.locator('.category-tabs [data-reorder-id="text"]')).toHaveClass(/active/);
  return after;
});

await run("tags:drag-switches-to-custom-and-click-still-filters", async () => {
  const p = await make();
  await expect(p.locator(".search-tag-chip").first()).toBeVisible();
  const before = await tagIds(p);
  expect(before.length).toBeGreaterThan(2);
  // Use a chip that is fully visible (the strip scrolls horizontally).
  const last = before[2];
  await longDrag(
    p,
    p.locator(`.search-tag-strip [data-reorder-id="${last}"]`),
    p.locator(`.search-tag-strip [data-reorder-id="${before[0]}"]`)
  );
  const after = await tagIds(p);
  expect(after[0]).toBe(last);
  expect(await setting(p, "app.search_tag_sort")).toBe("custom");
  expect(JSON.parse(await setting(p, "app.search_tag_order"))[0]).toBe(last);
  await expect(p.locator(".search-input")).toHaveValue("");
  await p.locator(`.search-tag-strip [data-reorder-id="${before[0]}"]`).click();
  await expect(p.locator(".search-input")).toHaveValue(`tag:${before[0]}`);
  return after;
});

await run("tags:custom-order-appends-new-tags-at-end", async () => {
  const probe = await make();
  const byCount = await tagIds(probe);
  expect(byCount.length).toBeGreaterThan(3);
  // Saved custom order holds only two tags (reversed); the rest are "new" and follow by count.
  const subset = [byCount[1], byCount[0]];
  const p = await make("savedTags&tagOrder=" + encodeURIComponent(subset.join(",")));
  await expect(p.locator(".search-tag-chip").first()).toBeVisible();
  expect(await tagIds(p)).toEqual([...subset, ...byCount.slice(2)]);
  return "ok";
});

await run("settings:reset-order-and-tag-sort-select", async () => {
  const p = await make();
  await longDrag(p, p.locator('.header-actions [data-reorder-id="settings"]'), p.locator('.header-actions [data-reorder-id="pin"]'));
  await longDrag(p, p.locator('.category-tabs [data-reorder-id="file"]'), p.locator('.category-tabs [data-reorder-id="default"]'));
  const tags = await tagIds(p);
  await longDrag(p, p.locator(`.search-tag-strip [data-reorder-id="${tags[2]}"]`), p.locator(`.search-tag-strip [data-reorder-id="${tags[0]}"]`));
  expect((await headerIds(p))[0]).toBe("settings");
  await p.locator('.header-actions [data-reorder-id="settings"]').click();
  await p.locator(".group-header", { hasText: "界面排序" }).click();
  const select = p.locator(".search-tag-sort-select");
  await expect(select).toHaveValue("custom");
  await p.locator(".ui-order-reset-btn").click();
  await expect(select).toHaveValue("count");
  expect(await setting(p, "app.header_button_order")).toBe("");
  expect(await setting(p, "app.category_tab_order")).toBe("");
  expect(await setting(p, "app.search_tag_order")).toBe("");
  await select.selectOption("custom");
  expect(await setting(p, "app.search_tag_sort")).toBe("custom");
  await select.selectOption("count");
  // Back to the main view: default orders again.
  await p.locator(".header-leading .btn-icon").first().click();
  await expect(p.locator('.header-actions [data-reorder-id="search"]')).toBeVisible();
  expect((await headerIds(p)).slice(0, 2)).toEqual(["pin", "search"]);
  expect((await tabIds(p))[0]).toBe("default");
  expect(await tagIds(p)).toEqual(tags);
  return "ok";
});

// ---- motion quality (the dragged item follows the pointer, siblings slide, no flicker) ----
const animCount = (loc) => loc.evaluate((el) => el.getAnimations().length);
const centerX = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; });

await run("motion:header-follows-pointer-siblings-slide-and-settle", async () => {
  const p = await make();
  const src = p.locator('.header-actions [data-reorder-id="settings"]');
  const pin = p.locator('.header-actions [data-reorder-id="pin"]');
  const s = await src.boundingBox();
  const t = await pin.boundingBox();
  const sx = s.x + s.width / 2, sy = s.y + s.height / 2;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  await p.waitForTimeout(650);
  await expect(src).toHaveAttribute("data-dragging", "true");
  const offsets = [];
  let sawSiblingAnim = false;
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const x = sx + ((t.x + 3 - sx) * i) / steps;
    await p.mouse.move(x, sy);
    await p.waitForTimeout(20);
    offsets.push(Math.abs((await centerX(src)) - x));
    if (!sawSiblingAnim) {
      sawSiblingAnim = await p.$$eval('.header-actions [data-reorder-id]:not([data-dragging])',
        (els) => els.some((el) => el.getAnimations().length > 0));
    }
  }
  // Follows the pointer 1:1 (small tolerance for sub-pixel rounding).
  expect(Math.max(...offsets)).toBeLessThan(4);
  // Siblings moved with an animation instead of teleporting.
  expect(sawSiblingAnim).toBe(true);
  await p.mouse.up();
  // Released item settles with an animation, then ends clean.
  expect(await animCount(src)).toBeGreaterThan(0);
  await p.waitForTimeout(400);
  expect(await animCount(src)).toBe(0);
  expect(await src.evaluate((el) => el.style.transform)).toBe("");
  expect((await headerIds(p))[0]).toBe("settings");
  return { maxOffset: Math.max(...offsets).toFixed(2) };
});

await run("motion:tags-no-flicker-during-slow-drag", async () => {
  const p = await make();
  await expect(p.locator(".search-tag-chip").first()).toBeVisible();
  const before = await tagIds(p);
  const src = p.locator(`.search-tag-strip [data-reorder-id="${before[0]}"]`);
  const target = p.locator(`.search-tag-strip [data-reorder-id="${before[2]}"]`);
  const s = await src.boundingBox();
  const t = await target.boundingBox();
  const sx = s.x + s.width / 2, sy = s.y + s.height / 2;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  await p.waitForTimeout(650);
  const positions = [];
  const steps = 30;
  const endX = t.x + t.width - 2;
  for (let i = 1; i <= steps; i++) {
    await p.mouse.move(sx + ((endX - sx) * i) / steps, sy);
    await p.waitForTimeout(16);
    positions.push((await tagIds(p)).indexOf(before[0]));
  }
  await p.mouse.up();
  await p.waitForTimeout(350);
  // Index only ever moves forward (never swaps back and forth).
  for (let i = 1; i < positions.length; i++) expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
  expect((await tagIds(p)).indexOf(before[0])).toBe(2);
  expect(p.errors).toEqual([]);
  return positions.join(",");
});

await run("update:pending-dialog-skip-version", async () => {
  const p = await make("savedTags&pendingUpdate=0.9.0");
  const dlg = p.locator(".update-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("0.2.0");
  await expect(dlg).toContainText("0.9.0");
  await expect(dlg.locator(".update-dialog-notes")).toContainText("示例条目一");
  // Clicking the backdrop does not close it.
  await p.mouse.click(5, 5);
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "不再提示" }).click();
  await expect(dlg).toHaveCount(0);
  expect(await calls(p, "dismiss_update")).toEqual([{ version: "0.9.0", skip: true }]);
  expect(await setting(p, "app.update_skipped_version")).toBe("0.9.0");
  // Focus again: the skipped version stays silent.
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.waitForTimeout(200);
  await expect(dlg).toHaveCount(0);
  return "ok";
});

await run("update:pending-dialog-go-download", async () => {
  const p = await make("savedTags&pendingUpdate=0.9.1");
  const dlg = p.locator(".update-dialog");
  await dlg.getByRole("button", { name: "前往下载" }).click();
  await expect(dlg).toHaveCount(0);
  expect(await calls(p, "open_release_page")).toEqual([
    { url: "https://github.com/qiluo11/luojian-clipboard/releases/tag/v0.9.1" }
  ]);
  expect(await calls(p, "dismiss_update")).toEqual([{ version: "0.9.1", skip: false }]);
  return "ok";
});

await run("update:shows-on-next-focus", async () => {
  const p = await make();
  await expect(p.locator(".update-dialog")).toHaveCount(0);
  await p.evaluate(() => {
    window.__audit.settings["app.update_pending"] = JSON.stringify({
      current_version: "0.2.0", latest_version: "0.9.2", has_update: true,
      release_url: "https://github.com/qiluo11/luojian-clipboard/releases/tag/v0.9.2",
      release_name: "", notes: "", published_at: ""
    });
    window.dispatchEvent(new Event("focus"));
  });
  await expect(p.locator(".update-dialog")).toContainText("0.9.2");
  return "ok";
});

await run("update:settings-frequency-and-manual-check-latest", async () => {
  const p = await make();
  await p.locator('.header-actions [data-reorder-id="settings"]').click();
  await p.locator(".group-header", { hasText: "检查更新" }).click();
  const sel = p.locator(".update-frequency-select");
  await expect(sel).toHaveValue("weekly");
  await sel.selectOption("never");
  expect(await setting(p, "app.update_check_frequency")).toBe("never");
  await expect(p.locator(".settings-group[data-group=update]")).toContainText("IP");
  await p.locator(".update-check-btn").click();
  await expect(p.locator(".update-check-status")).toContainText("已是最新版本");
  await expect(p.locator(".update-dialog")).toHaveCount(0);
  return "ok";
});

await run("update:manual-check-finds-new-version", async () => {
  const p = await make("savedTags&latest=0.9.3");
  await p.locator('.header-actions [data-reorder-id="settings"]').click();
  await p.locator(".group-header", { hasText: "检查更新" }).click();
  await p.locator(".update-check-btn").click();
  await expect(p.locator(".update-check-status")).toContainText("0.9.3");
  await expect(p.locator(".update-dialog")).toContainText("0.9.3");
  return "ok";
});

await run("update:manual-check-failure-message", async () => {
  const p = await make();
  await p.evaluate(() => { window.__audit.fail["check_for_update"] = true; });
  await p.locator('.header-actions [data-reorder-id="settings"]').click();
  await p.locator(".group-header", { hasText: "检查更新" }).click();
  await p.locator(".update-check-btn").click();
  await expect(p.locator(".update-check-status")).toContainText("检查失败");
  expect(p.errors).toEqual([]);
  return "ok";
});

await run("update:install-now-progress-then-installing", async () => {
  const p = await make("savedTags&pendingUpdate=0.9.4");
  const dlg = p.locator(".update-dialog");
  await expect(dlg.getByRole("button", { name: "立即更新" })).toBeVisible();
  await dlg.getByRole("button", { name: "立即更新" }).click();
  expect((await calls(p, "install_update")).length).toBe(1);
  // While downloading the dialog can't be dismissed.
  await expect(dlg.locator(".confirm-dialog-buttons")).toHaveCount(0);
  await p.mouse.click(5, 5);
  await expect(dlg).toBeVisible();
  const MB = 1024 * 1024;
  const scales = [];
  for (const done of [0.5, 1.2, 2.6, 4]) {
    await p.evaluate(([d, t]) => window.__audit.emit("update-progress", { downloaded: d, total: t }), [done * MB, 4 * MB]);
    await expect(dlg.locator(".update-dialog-status-text")).toContainText(`${done.toFixed(1)} / 4.0 MB`);
    scales.push(await dlg.locator(".update-dialog-progress-bar").evaluate((el) => {
      const m = /scaleX\(([\d.]+)\)/.exec(el.style.transform); return m ? Number(m[1]) : -1;
    }));
  }
  // Monotonic, ends full, driven by transform (no width animation).
  for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeGreaterThan(scales[i - 1]);
  expect(scales.at(-1)).toBe(1);
  const tr = await dlg.locator(".update-dialog-progress-bar").evaluate((el) => getComputedStyle(el).transitionProperty);
  expect(tr).toBe("transform");
  await p.evaluate(() => window.__audit.emit("update-installing", null));
  await expect(dlg.locator(".update-dialog-status")).toContainText("正在安装");
  await expect(dlg.locator(".update-dialog-progress")).toHaveCount(0);
  await expect(dlg.locator(".confirm-dialog-buttons")).toHaveCount(0);
  expect(await calls(p, "dismiss_update")).toEqual([]);
  expect(p.errors).toEqual([]);
  return scales.join(",");
});

await run("update:install-failure-shows-error-and-fallback", async () => {
  const p = await make("savedTags&pendingUpdate=0.9.5");
  const dlg = p.locator(".update-dialog");
  await dlg.getByRole("button", { name: "立即更新" }).click();
  await p.evaluate(() => window.__audit.emit("update-progress", { downloaded: 1024, total: null }));
  await expect(dlg.locator(".update-dialog-status-text")).toContainText("正在下载 0.0 MB");
  await p.evaluate(() => window.__audit.install.reject("signature verification failed"));
  await expect(dlg.locator(".update-dialog-status.is-error")).toContainText("signature verification failed");
  await expect(dlg.getByRole("button", { name: "前往下载" })).toBeVisible();
  // Retry calls install_update again.
  await dlg.getByRole("button", { name: "立即更新" }).click();
  expect((await calls(p, "install_update")).length).toBe(2);
  await expect(dlg.locator(".update-dialog-status.is-error")).toHaveCount(0);
  await p.evaluate(() => window.__audit.install.reject("network down"));
  await dlg.getByRole("button", { name: "前往下载" }).click();
  await expect(dlg).toHaveCount(0);
  expect(await calls(p, "open_release_page")).toEqual([
    { url: "https://github.com/qiluo11/luojian-clipboard/releases/tag/v0.9.5" }
  ]);
  expect(p.errors).toEqual([]);
  return "ok";
});

await run("update:install-now-english-labels-fit", async () => {
  const p = await make("savedTags&pendingUpdate=0.9.6&lang=en", 352, 420);
  const dlg = p.locator(".update-dialog");
  await expect(dlg).toBeVisible();
  const box = await dlg.boundingBox();
  const vw = await p.evaluate(() => window.innerWidth);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
  const btns = dlg.locator(".confirm-dialog-button");
  expect(await btns.count()).toBe(3);
  for (let i = 0; i < 3; i++) {
    const b = await btns.nth(i).boundingBox();
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
  return `${Math.round(box.width)}px/${vw}px`;
});

await run("update:lanzou-link-in-dialog-and-settings", async () => {
  const LZ = "https://wwayd.lanzouu.com/b01gica1pa";
  const p = await make("savedTags&pendingUpdate=0.9.7", 352, 420);
  const dlg = p.locator(".update-dialog");
  const link = dlg.locator(".lanzou-link");
  await expect(link).toContainText("蓝奏云（密码 edql）");
  await link.click();
  expect(await calls(p, "open_release_page")).toEqual([{ url: LZ }]);
  // Opening the mirror doesn't dismiss the dialog.
  await expect(dlg).toBeVisible();
  expect(await calls(p, "dismiss_update")).toEqual([]);
  // Still shown after an install failure.
  await dlg.getByRole("button", { name: "立即更新" }).click();
  await p.evaluate(() => window.__audit.install.reject("timeout"));
  await expect(dlg.locator(".lanzou-link")).toBeVisible();
  await dlg.getByRole("button", { name: "不再提示" }).click();
  // Settings row.
  await p.locator('.header-actions [data-reorder-id="settings"]').click();
  await p.locator(".group-header", { hasText: "检查更新" }).click();
  const row = p.locator(".update-settings-lanzou");
  await expect(row).toContainText("edql");
  await row.click();
  expect(await calls(p, "open_release_page")).toEqual([{ url: LZ }, { url: LZ }]);
  expect(p.errors).toEqual([]);
  return "ok";
});

await run("update:no-release-json-shows-friendly-message", async () => {
  const p = await make();
  await p.evaluate(() => { window.__audit.fail["check_for_update_nojson"] = true; });
  await p.locator('.header-actions [data-reorder-id="settings"]').click();
  await p.locator(".group-header", { hasText: "检查更新" }).click();
  await p.locator(".update-check-btn").click();
  const st = p.locator(".update-check-status");
  await expect(st).toContainText("无法获取更新信息");
  await expect(st).toContainText("蓝奏云");
  await expect(st).not.toContainText("release JSON");
  await expect(p.locator(".update-settings-lanzou")).toBeVisible();
  expect(p.errors).toEqual([]);
  return "ok";
});

await fs.writeFile(artifact("reorder-update-results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.status === "fail");
console.log(`${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
