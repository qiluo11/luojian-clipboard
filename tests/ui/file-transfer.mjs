import { chromium } from "playwright";
import { expect } from "@playwright/test";
// 局域网文件传输（2026-09-27 恢复）：设置入口、开关、头部聊天按钮、聊天视图进出。
// 只用测试替身，不开真实端口。
const base = (process.env.TIEZ_TEST_URL || "http://127.0.0.1:5175").replace(/\/$/, "");
const browser = await chromium.launch(process.env.TIEZ_PW_CHANNEL ? { channel: process.env.TIEZ_PW_CHANNEL } : {});
const results = [];
const pages = [];
async function run(name, fn) {
  try {
    results.push({ name, status: "pass", detail: await fn() });
  } catch (e) {
    results.push({ name, status: "fail", error: e.message.slice(0, 600) });
  } finally {
    for (const page of pages.splice(0)) await page.close().catch(() => {});
  }
  console.log(results.at(-1));
}
async function make() {
  const p = await browser.newPage({ viewport: { width: 352, height: 640 } });
  pages.push(p);
  p._errors = [];
  p.on("pageerror", (e) => p._errors.push(e.message));
  p.setDefaultTimeout(5000);
  const url = `${base}/tests/ui/index.html?mode=light&theme=mica`;
  await p.goto(url, { timeout: 60000 }).catch(() => p.goto(url, { timeout: 60000 }));
  await expect(p.locator(".history-item").first()).toBeVisible();
  return p;
}
async function openGroup(p) {
  await p.getByTitle("设置", { exact: true }).click();
  const header = p.locator(".settings-group .group-header", { hasText: "局域网文件传输" });
  await expect(header).toHaveCount(1);
  await header.scrollIntoViewIfNeeded();
  await header.click();
  const group = p
    .locator(".settings-group")
    .filter({ has: p.locator(".group-header", { hasText: "局域网文件传输" }) });
  await expect(group).not.toHaveClass(/collapsed/);
  return group;
}
const enableSwitch = (group) =>
  group.locator(".setting-item", { hasText: "启用文件服务" }).locator("label.switch");
const chatBtn = (p) => p.locator("header .header-chat-btn");

await run("settings:group-visible-and-off-by-default", async () => {
  const p = await make();
  await expect(chatBtn(p)).toHaveCount(0);
  const group = await openGroup(p);
  await expect(group.locator("input.cb").first()).not.toBeChecked();
  expect(p._errors).toEqual([]);
});

await run("toggle:enable-shows-address-and-header-chat-button", async () => {
  const p = await make();
  const group = await openGroup(p);
  await enableSwitch(group).click();
  await expect(chatBtn(p)).toHaveCount(1);
  await expect(group).toContainText("192.168.1.23");
  await expect(group.locator("canvas").first()).toBeVisible();
  expect(await p.evaluate(() => window.__audit.settings["file_server_enabled"])).toBe("true");
  expect(p._errors).toEqual([]);
});

await run("chat:open-and-return-to-settings", async () => {
  const p = await make();
  const group = await openGroup(p);
  await enableSwitch(group).click();
  await chatBtn(p).click();
  await expect(p.locator(".wt-chat-view")).toBeVisible();
  await expect(p.locator(".settings-group")).toHaveCount(0);
  await chatBtn(p).click();
  await expect(p.locator(".wt-chat-view")).toHaveCount(0);
  await expect(p.locator(".settings-group", { hasText: "局域网文件传输" })).toHaveCount(1);
  expect(p._errors).toEqual([]);
});

await run("toggle:disable-hides-chat-button", async () => {
  const p = await make();
  const group = await openGroup(p);
  await enableSwitch(group).click();
  await expect(chatBtn(p)).toHaveCount(1);
  await enableSwitch(group).click();
  await expect(chatBtn(p)).toHaveCount(0);
  expect(await p.evaluate(() => window.__audit.settings["file_server_enabled"])).toBe("false");
  expect(await p.evaluate(() => [...window.__audit.unknown])).toEqual([]);
});

const failed = results.filter((r) => r.status !== "pass");
console.log(`FileTransfer: ${results.length - failed.length}/${results.length} passed`);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
process.exit(failed.length ? 1 : 0);
