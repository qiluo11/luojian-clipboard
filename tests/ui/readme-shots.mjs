// README 主题截图：隔离测试页 + 模拟数据（?demo=1），不连接真实程序和数据库。
// 用法：先启动 `npm exec vite -- --config tests/ui/vite.config.ts`，再运行
//   TIEZ_PW_CHANNEL=msedge node tests/ui/readme-shots.mjs
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import path from "node:path";

const base = (process.env.TIEZ_TEST_URL || "http://127.0.0.1:5175").replace(/\/$/, "");
const outDir = process.env.README_SHOT_DIR || path.join("docs", "images");
const shots = [
  { theme: "sticky-note", mode: "light", file: "theme-sticky-note.png" },
  { theme: "sakura", mode: "light", file: "theme-sakura.png" },
  { theme: "minimal", mode: "light", file: "theme-minimal.png" },
  { theme: "graphite", mode: "dark", file: "theme-graphite-dark.png" },
  // “最近打开”功能演示
  { theme: "minimal", mode: "light", file: "recent-opens.png", tab: "最近打开" },
];

const browser = await chromium.launch(process.env.TIEZ_PW_CHANNEL ? { channel: process.env.TIEZ_PW_CHANNEL } : {});
let failed = 0;
for (const s of shots) {
  const p = await browser.newPage({ viewport: { width: 360, height: 560 }, deviceScaleFactor: 2, colorScheme: s.mode });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    const url = `${base}/tests/ui/index.html?theme=${s.theme}&mode=${s.mode}&demo=1`;
    // The first load after a cold vite start can exceed the timeout; retry once.
    await p.goto(url, { timeout: 60000 }).catch(() => p.goto(url, { timeout: 60000 }));
    await expect(p.locator(".history-item").first()).toBeVisible({ timeout: 10000 });
    await expect(p.locator("html")).toHaveClass(new RegExp(`theme-${s.theme}`));
    if (s.tab) {
      await p.locator("button.category-tab", { hasText: s.tab }).click();
      await p.waitForTimeout(600);
    }
    await p.mouse.move(0, 0);
    await p.waitForTimeout(900); // 等入场动画结束
    await p.screenshot({ path: path.join(outDir, s.file) });
    console.log(`ok ${s.file}${errors.length ? " pageerror: " + errors.join(" | ") : ""}`);
    if (errors.length) failed++;
  } catch (e) {
    failed++;
    console.log(`FAIL ${s.file}: ${e.message}`);
  }
  await p.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
