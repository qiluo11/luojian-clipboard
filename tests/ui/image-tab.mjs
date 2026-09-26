// 复现/回归：刚启动就切到“图片”标签时，应显示全部图片（合成数据共 57 张）。
// 用法：先启动测试页（vite --config tests/ui/vite.config.ts），再 node tests/ui/image-tab.mjs
import { chromium } from "playwright";
const base = (process.env.TIEZ_TEST_URL || "http://127.0.0.1:5175").replace(/\/$/, "");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.TIEZ_PW_CHANNEL ? { channel: process.env.TIEZ_PW_CHANNEL } : {}),
});
const EXPECTED = 57;
let failed = 0;

async function countList(p) {
  // 虚拟列表只渲染可见条目：一路滚到底，记录最大的 data-index
  return p.evaluate(async () => {
    const scroller = document.querySelector("[data-virtuoso-scroller]") ||
      document.querySelector(".history-item")?.closest("[data-testid], [style*='overflow']");
    let max = -1, stable = 0, images = 0, texts = 0;
    const seen = new Set();
    while (stable < 4) {
      document.querySelectorAll("[data-index]").forEach((el) => {
        const i = Number(el.getAttribute("data-index"));
        if (!seen.has(i)) {
          seen.add(i);
          if (el.querySelector("img")) images++; else texts++;
        }
        if (i > max) max = i;
      });
      const before = scroller ? scroller.scrollTop : 0;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      await new Promise((r) => setTimeout(r, 150));
      stable = scroller && scroller.scrollTop !== before ? 0 : stable + 1;
    }
    return { total: max + 1, images, texts };
  });
}

for (const slow of [0, 300, 1000]) {
  const p = await browser.newPage({ viewport: { width: 352, height: 640 } });
  const url = `${base}/tests/ui/index.html?manyImages=1${slow ? `&slowImage=${slow}` : ""}`;
  await p.goto(url, { timeout: 60000 }).catch(() => p.goto(url, { timeout: 60000 }));
  await p.locator(".history-item").first().waitFor();
  await p.locator("button.category-tab", { hasText: "图片" }).click();
  await p.waitForTimeout(slow + 2000);
  const r = await countList(p);
  const calls = await p.evaluate(() =>
    window.__audit.calls.filter((c) => c.cmd === "get_clipboard_history")
      .map((c) => `${c.args.contentType || "all"}@${c.args.offset}`));
  const ok = r.total === EXPECTED && r.texts === 0;
  if (!ok) failed++;
  console.log(JSON.stringify({ slowImage: slow, ok, ...r, calls }));
  await p.close();
}
// 分页没被破坏：默认列表 300 条，滚到底应能逐页加载完
{
  const p = await browser.newPage({ viewport: { width: 352, height: 640 } });
  await p.goto(`${base}/tests/ui/index.html?manyImages=1`, { timeout: 60000 });
  await p.locator(".history-item").first().waitFor();
  await p.waitForTimeout(1000);
  let r = { total: 0 };
  for (let k = 0; k < 6 && r.total < 300; k++) r = await countList(p);
  const ok = r.total === 300;
  if (!ok) failed++;
  console.log(JSON.stringify({ paging: true, ok, total: r.total }));
  await p.close();
}
await browser.close();
console.log(failed ? `FAIL ${failed}` : "PASS");
process.exit(failed ? 1 : 0);
