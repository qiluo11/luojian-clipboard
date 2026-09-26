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

const browser = await chromium.launch({ headless: true, ...(process.env.TIEZ_PW_CHANNEL ? { channel: process.env.TIEZ_PW_CHANNEL } : {}) });
const results = [];
async function run(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, status: "pass", detail });
  } catch (e) {
    results.push({ name, status: "fail", error: e.message });
  }
  console.log(results.at(-1));
}
async function make(width = 352, mode = "light", height = 640, theme = "mica") {
  const p = await browser.newPage({ viewport: { width, height } });
  p._errors = [];
  p.on("pageerror", (e) => p._errors.push(e.message));
  const url = `${base}/tests/ui/index.html?mode=${mode}&theme=${theme}`;
  // The first load after a cold vite start can exceed the timeout; retry once.
  await p.goto(url, { timeout: 60000 }).catch(() => p.goto(url, { timeout: 60000 }));
  await expect(p.locator(".history-item").first()).toBeVisible();
  return p;
}
async function view(p, v) {
  if (v === "tags") await p.getByTitle("标签管理", { exact: true }).click();
  if (v === "favorites")
    await p.getByRole("button", { name: "收藏", exact: true }).click();
  if (v === "settings") await p.getByTitle("设置", { exact: true }).click();
  await p.waitForTimeout(180);
}
// Original app markup/CSS, no layout overrides. Zoom cases model reduced CSS viewport, not Windows DPI.
for (const [width, mode, label, theme] of [
  [352, "light", "default", "mica"],
  [250, "light", "minimum", "mica"],
  [700, "light", "wide", "mica"],
  [352, "dark", "dark", "mica"],
  [282, "light", "zoom125-equivalent", "mica"],
  [235, "dark", "zoom150-stress", "mica"],
  [352, "dark", "retro-dark", "retro"],
]) {
  for (const v of ["main", "tags", "favorites", "settings"])
    await run(`render:${v}:${label}`, async () => {
      const p = await make(width, mode, 640, theme);
      await view(p, v);
      expect(p._errors).toEqual([]);
      expect(await p.evaluate(() => [...window.__audit.unknown])).toEqual([]);
      expect(await p.locator("body").getAttribute("class")).toContain(
        mode + "-mode",
      );
      const selector = {
        main: ".history-item",
        tags: ".tag-manager-container",
        favorites: ".favorites-view",
        settings: ".settings-group",
      }[v];
      if (v !== "tags") await expect(p.locator(selector).first()).toBeVisible();
      else
        await expect(p.locator(".selected-tag-indicator")).toHaveText("#工作");
      await p.screenshot({ path: artifact(`${v}-${label}.png`) });
      await p.close();
      return { width, mode, theme };
    });
}
await run("interaction:search-and-clear", async () => {
  const p = await make();
  const input = p.getByPlaceholder("搜索剪切板...");
  await input.fill("只属于标签 A");
  await expect(p.locator(".history-item")).toHaveCount(1);
  await input.fill("");
  await expect(p.locator(".history-item")).toHaveCount(6);
  await p.close();
});
await run("interaction:favorite-search-and-rename", async () => {
  const p = await make();
  await view(p, "favorites");
  const input = p.getByPlaceholder("搜索收藏...");
  await input.fill("example.com");
  await expect(p.locator(".favorite-item")).toHaveCount(1);
  await input.fill("");
  await expect(p.locator(".favorite-item")).toHaveCount(3);
  // Filtering uses animated keyed rows. Count=3 can precede final DOM order;
  // wait for the original first fixture, then edit that card (not an exiting row).
  await expect(p.locator(".favorite-item").first()).toContainText("收藏长标题");
  await p.locator(".favorite-item").first().getByTitle("编辑标题").click();
  await p.locator(".favorite-title-input").fill("审计重命名");
  await p.locator(".favorite-title-input").press("Enter");
  await expect(p.locator(".favorite-item").first()).toContainText("审计重命名");
  await p.close();
});
await run("interaction:tag-batch-toolbar", async () => {
  const p = await make(250);
  await view(p, "tags");
  await p.getByTitle("管理条目").click();
  await expect(p.locator(".batch-toolbar")).toBeVisible();
  await p.locator(".themed-card").first().click();
  await expect(p.locator(".batch-selection-count")).toContainText("1");
  await expect(
    p.getByRole("button", { name: "复制选中", exact: true }),
  ).toBeEnabled();
  await p.screenshot({ path: artifact("tags-batch-250.png") });
  await p.close();
});
await run("defect:tag-response-race", async () => {
  const p = await make();
  await view(p, "tags");
  await p.evaluate(() => {
    window.__audit.wait["get_tag_items:标签A"] = 700;
    window.__audit.wait["get_tag_items:标签B"] = 40;
  });
  await p.locator(".tag-item").filter({ hasText: "标签A" }).click();
  await p.locator(".tag-item").filter({ hasText: "标签B" }).click();
  await expect(p.locator(".selected-tag-indicator")).toHaveText("#标签B");
  await p.waitForTimeout(850);
  await p.screenshot({ path: artifact("BUG-tag-race.png") });
  const detail = {
    label: await p.locator(".selected-tag-indicator").innerText(),
    wrongContent: await p
      .getByText("只属于标签 A 的内容", { exact: true })
      .count(),
    correctContent: await p
      .getByText("只属于标签 B 的内容", { exact: true })
      .count(),
  };
  await fs.writeFile(artifact("tag-race-state.json"), JSON.stringify(detail));
  await p.close();
  expect(detail.wrongContent).toBe(0);
  return detail;
});
await run("defect:favorite-context-menu-right-edge", async () => {
  const p = await make();
  await view(p, "favorites");
  const card = p.locator(".favorite-item").first();
  const rect = await card.boundingBox();
  await card.click({
    button: "right",
    position: { x: rect.width - 14, y: rect.height - 12 },
  });
  await expect(p.locator(".clipboard-item-context-menu")).toBeVisible();
  const r = await p.locator(".clipboard-item-context-menu").boundingBox();
  await p.screenshot({ path: artifact("BUG-favorite-menu.png") });
  await fs.writeFile(artifact("favorite-menu-bounds.json"), JSON.stringify(r));
  await p.close();
  expect(r.x + r.width).toBeLessThanOrEqual(352);
  return r;
});
await run("defect:main-header-at-minimum-width", async () => {
  const p = await make(250);
  const r = await p.getByTitle("隐藏", { exact: true }).boundingBox();
  await p.close();
  expect(r.x + r.width).toBeLessThanOrEqual(250);
  return r;
});
await run("interaction:web-ai-default-delay-validation", async () => {
  const p = await make();
  await view(p, "settings");
  const input = p.getByRole("spinbutton", {
    name: "默认粘贴延迟",
    exact: true,
  });
  await input.fill("1.5");
  await input.press("Enter");
  await expect
    .poll(() =>
      p.evaluate(() => window.__audit.settings["app.web_ai_paste_delay_ms"]),
    )
    .toBe("1500");
  await input.fill("61");
  await input.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  expect(
    await p.evaluate(
      () => window.__audit.settings["app.web_ai_paste_delay_ms"],
    ),
  ).toBe("1500");
  await p.close();
});
await run("interaction:web-ai-shared-site-and-reset", async () => {
  const p = await make();
  await view(p, "settings");
  const input = p.getByRole("spinbutton", { name: "DeepSeek", exact: true });
  await expect(input).toHaveCount(1);
  const cb = p.getByRole("checkbox", {
    name: "DeepSeek: 单独设置",
    exact: true,
  });
  await cb.click();
  await expect(cb).toBeChecked();
  await expect(input).toBeEnabled();
  await input.fill("5");
  await input.press("Enter");
  await expect(input).toHaveValue("5");
  await cb.click();
  await expect(cb).not.toBeChecked();
  await expect(input).toBeDisabled();
  // 取消单独设置后回到默认延迟（2026-09-26 起默认 3 秒）
  await expect(input).toHaveValue("3");
  await p.close();
});
await run("defect:tag-content-height-at-default-window-size", async () => {
  const p = await make(352, "light", 380);
  await view(p, "tags");
  await p.waitForTimeout(250);
  const r = await p.locator(".items-area").boundingBox();
  await p.screenshot({ path: artifact("BUG-tag-height.png") });
  await p.close();
  expect(r.height).toBeGreaterThanOrEqual(64);
  return r;
});
await fs.writeFile(
  artifact("regression-results.json"),
  JSON.stringify(results, null, 2),
);
await browser.close();

if (results.some((result) => result.status === "fail")) process.exitCode = 1;
