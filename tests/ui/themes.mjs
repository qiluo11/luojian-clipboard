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
const browser = await chromium.launch(process.env.TIEZ_PW_CHANNEL ? { channel: process.env.TIEZ_PW_CHANNEL } : {});
const results = [];
const pages = [];
async function run(name, fn) {
  try {
    results.push({ name, status: "pass", detail: await fn() });
  } catch (e) {
    results.push({ name, status: "fail", error: e.message });
  } finally {
    for (const p of pages.splice(0)) await p.close();
  }
  console.log(results.at(-1));
}
async function make(
  theme = "mica",
  mode = "light",
  width = 352,
  height = 380,
  extra = "",
  system = "light",
) {
  const p = await browser.newPage({
    viewport: { width, height },
    colorScheme: system,
  });
  pages.push(p);
  p.setDefaultTimeout(6000);
  p.setDefaultNavigationTimeout(30000);
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.goto(
    `${base}/tests/ui/index.html?theme=${theme}&mode=${mode}&${extra}`,
  );
  await expect(p.locator(".history-item").first()).toBeVisible();
  await expect(p.locator("html")).toHaveClass(new RegExp(`theme-${theme}`));
  return p;
}
async function openMenu(p) {
  const content = p.locator(".history-item .content-preview").first();
  const b = await content.boundingBox();
  await content.click({
    button: "right",
    position: { x: b.width - 8, y: Math.min(b.height - 4, 24) },
  });
  await expect(p.locator(".viewport-popover")).toBeVisible();
}
async function bounded(p, selector = ".viewport-popover") {
  const r = await p.locator(selector).boundingBox();
  const v = p.viewportSize();
  expect(r).not.toBeNull();
  expect(r.x).toBeGreaterThanOrEqual(7);
  expect(r.y).toBeGreaterThanOrEqual(7);
  expect(r.x + r.width).toBeLessThanOrEqual(v.width - 7);
  expect(r.y + r.height).toBeLessThanOrEqual(v.height - 7);
  return r;
}
async function surface(p, selector) {
  return p.locator(selector).evaluate((e) => {
    const s = getComputedStyle(e);
    return {
      bg: s.backgroundColor,
      image: s.backgroundImage,
      color: s.color,
      border: s.borderTopWidth,
      borderColor: s.borderTopColor,
      radius: s.borderRadius,
      shadow: s.boxShadow,
      font: s.fontFamily,
      opacity: s.opacity,
    };
  });
}
function opaque(s) {
  expect(s.bg).not.toBe("transparent");
  expect(s.bg).not.toMatch(/^rgba\(/);
  expect(s.image).toContain("linear-gradient");
}
for (const theme of [
  "retro",
  "sticky-note",
  "mica",
  "acrylic",
  "paper",
  "sakura",
  "minimal",
  "graphite",
])
  for (const mode of ["light", "dark"]) {
    await run(`surfaces:${theme}:${mode}`, async () => {
      const p = await make(theme, mode);
      await openMenu(p);
      expect(
        await p
          .locator(".viewport-popover")
          .evaluate((e) => e.parentElement === document.body),
      ).toBe(true);
      const initial = await bounded(p);
      const menu = await surface(p, ".viewport-popover");
      opaque(menu);
      await p.locator(".viewport-popover button[aria-expanded]").click();
      await expect(
        p.locator(".clipboard-item-context-menu__sub-group"),
      ).toBeVisible();
      await expect
        .poll(() =>
          p
            .locator(".viewport-popover")
            .evaluate((e) => Math.round(e.getBoundingClientRect().bottom)),
        )
        .toBeLessThanOrEqual(373);
      const expanded = await bounded(p);
      await p.screenshot({ path: path.join(dir, `${theme}-${mode}-menu.png`) });
      await p
        .getByRole("button", { name: "DeepSeek 测试提问", exact: true })
        .click();
      await expect(p.locator(".toast-item")).toContainText("已送到浏览器");
      await expect
        .poll(() =>
          p.locator(".toast-item").evaluate((e) => getComputedStyle(e).opacity),
        )
        .toBe("1");
      const success = await surface(p, ".toast-item");
      opaque(success);
      await bounded(p, ".toast-item");
      expect(success.border).toBe(menu.border);
      expect(success.radius).toBe(menu.radius);
      expect(success.shadow).toBe(menu.shadow);
      if (theme !== "retro") expect(success.border).toBe("1px");
      await p.screenshot({
        path: path.join(dir, `${theme}-${mode}-toast.png`),
      });
      await p.getByTitle("清空历史", { exact: true }).click();
      await expect(p.locator(".confirm-dialog")).toBeVisible();
      opaque(await surface(p, ".confirm-dialog"));
      await bounded(p, ".confirm-dialog");
      await p.locator(".confirm-dialog-button").first().click();
      await p.getByRole("button", { name: "收藏", exact: true }).click();
      await p
        .locator(".favorite-item .content-preview")
        .first()
        .click({ button: "right" });
      const favorite = await surface(p, ".favorite-popover");
      opaque(favorite);
      await bounded(p);
      expect(favorite.bg).toBe(menu.bg);
      expect(favorite.image).toBe(menu.image);
      expect(p.errors).toEqual([]);
      return { initial, expanded, menu, toast: success };
    });
  }
for (const theme of ["minimal", "graphite"])
  for (const mode of ["light", "dark"]) {
    await run(`new-theme:settings-switch:${theme}:${mode}`, async () => {
      const p = await make("mica", mode, 250, 640);
      await p.getByTitle("设置", { exact: true }).click();
      await p
        .locator(".settings-group")
        .filter({ has: p.getByText("界面设置", { exact: true }) })
        .locator(".group-header")
        .click();
      await expect(p.locator(".theme-choice-btn")).toHaveCount(8);
      await p
        .getByRole("button", {
          name: theme === "minimal" ? "现代简约" : "石墨灰",
          exact: true,
        })
        .click();
      await expect(p.locator("html")).toHaveClass(new RegExp(`theme-${theme}`));
      expect(
        await p.evaluate(() =>
          Array.from(document.body.classList).filter((c) =>
            c.startsWith("theme-"),
          ),
        ),
      ).toEqual([`theme-${theme}`]);
      await expect
        .poll(() => p.evaluate(() => window.__audit.settings["app.theme"]))
        .toBe(theme);
      // Wait for the existing 200ms color transition, and verify control tokens too.
      const accent = await p.evaluate(() => {
        const h = getComputedStyle(document.documentElement)
          .getPropertyValue("--accent-color")
          .trim()
          .slice(1);
        return `rgb(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ")})`;
      });
      await expect
        .poll(() =>
          p
            .locator(".settings-inline-choice-btn.active")
            .first()
            .evaluate((e) => getComputedStyle(e).backgroundColor),
        )
        .toBe(accent);
      await p.locator(".theme-choice-grid").scrollIntoViewIfNeeded();
      await p.screenshot({
        path: path.join(dir, `${theme}-${mode}-settings.png`),
      });
      expect(
        await p.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(250);
      await p.getByRole("button", { name: "云母", exact: true }).click();
      await expect(p.locator("html")).toHaveClass(/theme-mica/);
      expect(p.errors).toEqual([]);
    });
  }
for (const theme of ["minimal", "graphite"])
  for (const system of ["light", "dark"])
    await run(`new-theme:system-mode:${theme}:${system}`, async () => {
      const p = await make(theme, "system", 352, 380, "", system);
      const auto = await p
        .locator("#root")
        .evaluate((e) => getComputedStyle(e).backgroundColor);
      const manual = await make(theme, system);
      expect(auto).toBe(
        await manual
          .locator("#root")
          .evaluate((e) => getComputedStyle(e).backgroundColor),
      );
    });
await run("menu:long-prompts-own-scroll-and-resize", async () => {
  const p = await make("acrylic", "dark", 250, 290, "manyPrompts=1");
  await openMenu(p);
  await p.locator(".viewport-popover button[aria-expanded]").click();
  await expect(
    p.locator(".clipboard-item-context-menu__item--sub"),
  ).toHaveCount(30);
  await expect
    .poll(() =>
      p
        .locator(".viewport-popover")
        .evaluate((e) => e.getBoundingClientRect().height),
    )
    .toBeLessThanOrEqual(274);
  await bounded(p);
  await p.locator(".viewport-popover").evaluate((e) => (e.scrollTop = 300));
  await expect(p.locator(".viewport-popover")).toBeVisible();
  expect(
    await p.locator(".viewport-popover").evaluate((e) => e.scrollTop),
  ).toBeGreaterThan(0);
  await p.screenshot({ path: path.join(dir, "menu-long-prompts.png") });
  await p.setViewportSize({ width: 280, height: 330 });
  await expect(p.locator(".viewport-popover")).toHaveCount(0);
});
await run("menu:background-scroll-escape-outside-click", async () => {
  const p = await make();
  await openMenu(p);
  await p.keyboard.press("Escape");
  await expect(p.locator(".viewport-popover")).toHaveCount(0);
  await openMenu(p);
  await p
    .locator("[data-virtuoso-scroller]")
    .evaluate((e) => (e.scrollTop += 50));
  await expect(p.locator(".viewport-popover")).toHaveCount(0);
  await openMenu(p);
  await p.locator(".header-title").click();
  await expect(p.locator(".viewport-popover")).toHaveCount(0);
});
await run("menu:properties-action-does-not-copy", async () => {
  const p = await make();
  await openMenu(p);
  await p
    .locator(".viewport-popover")
    .getByRole("button", { name: "属性", exact: true })
    .click();
  await expect(p.locator(".item-properties-panel")).toBeVisible();
  await expect(p.locator(".viewport-popover")).toHaveCount(0);
  opaque(await surface(p, ".item-properties-panel"));
  expect(
    await p.evaluate(() =>
      window.__audit.calls.filter((c) => c.cmd === "copy_to_clipboard"),
    ),
  ).toEqual([]);
});
await run("toast:failure-and-long-message-small-window", async () => {
  const p = await make("mica", "dark", 250, 290);
  await p.evaluate(() => (window.__audit.fail["web_ai_ask:"] = true));
  await openMenu(p);
  await p.locator(".viewport-popover button[aria-expanded]").click();
  await p
    .getByRole("button", { name: "DeepSeek 测试提问", exact: true })
    .click();
  await expect(p.locator(".toast-item")).toBeVisible();
  const text = await p.locator(".toast-item").innerText();
  expect(text).not.toContain("已送到浏览器");
  opaque(await surface(p, ".toast-item"));
  await bounded(p, ".toast-item");
  await expect(p.locator(".toast-item")).toHaveCount(0, { timeout: 10000 });
  await p.evaluate(() =>
    window.__audit.emit("toast", "测试失败：" + "LongUnbrokenError".repeat(20)),
  );
  await expect(p.locator(".toast-item")).toBeVisible();
  await p.waitForTimeout(250);
  const r = await p.locator(".toast-item").boundingBox();
  expect(r.x).toBeGreaterThanOrEqual(15);
  expect(r.x + r.width).toBeLessThanOrEqual(235);
  expect(
    await p
      .locator(".toast-item")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
});
await fs.writeFile(
  path.join(dir, "theme-results.json"),
  JSON.stringify(results, null, 2),
);
await browser.close();
console.log(
  `${results.filter((r) => r.status === "pass").length}/${results.length} passed`,
);
if (results.some((r) => r.status === "fail")) process.exitCode = 1;
