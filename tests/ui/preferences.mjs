import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const base = process.env.TIEZ_TEST_URL || 'http://127.0.0.1:5175';
const dir = process.env.TIEZ_TEST_ARTIFACT_DIR || '/tmp/tiez-preferences';
await fs.mkdir(dir,{recursive:true});
const browser = await chromium.launch(process.env.TIEZ_PW_CHANNEL ? { channel: process.env.TIEZ_PW_CHANNEL } : {});
const results=[]; let page;
async function run(name,fn) {
  try { results.push({name,status:'pass',detail:await fn()}); }
  catch(e) { results.push({name,status:'fail',error:e.message}); if(page) await page.screenshot({path:path.join(dir,name.replace(/[^a-z0-9-]/gi,'_')+'.png')}).catch(()=>{}); }
  finally { if(page) await page.close(); page=null; }
  console.log(results.at(-1));
}
async function make(query='') {
  page = await browser.newPage({viewport:{width:760,height:840}});
  page.setDefaultTimeout(7000);page.setDefaultNavigationTimeout(30000);
  await page.goto(`${base}/tests/ui/index.html?theme=mica&${query}`);
  await expect(page.locator('.history-item').first()).toBeVisible();
  return page;
}
async function settings(p,group='剪贴板设置') {
  await p.getByTitle('设置',{exact:true}).click();
  const card=p.locator('.settings-category-card').filter({hasText:group});
  if(await card.count()) await card.click();
  else await p.getByText(group,{exact:true}).click();
}
const row=(p,label)=>p.locator('.setting-item').filter({has:p.getByText(label,{exact:true})});
const chord=(p,label)=>row(p,label).locator('.key-group');
const calls=(p,cmd)=>p.evaluate(cmd=>window.__audit.calls.filter(c=>c.cmd===cmd),cmd);
await run('plain-shortcut-labels',async()=>{
 const p=await make(); await settings(p);
 const caps=await p.locator('.key-group').allTextContents();
 expect(caps).toContain('Alt + V');expect(caps).toContain('Alt + Shift + V');expect(caps).toContain('Alt + F');
 expect(caps.join('')).not.toMatch(/[⌥⇧⌘⌃]/); return caps;
});
await run('unchanged-native-binding-is-noop',async()=>{
 const p=await make();await settings(p);const c=chord(p,'搜索快捷键');await c.click();
 await expect(c).toHaveClass(/recording/);
 await p.evaluate(()=>{window.__audit.calls.length=0;window.__audit.emit('hotkey-recorded','alt+KeyF');});
 await expect(c).toHaveText('Alt + F');expect((await calls(p,'test_hotkey_available')).length).toBe(0);
 expect((await calls(p,'set_search_hotkey')).length).toBe(0); await expect(p.locator('.toast-item')).toHaveCount(0);
});
await run('native-dom-duplicate-single-save',async()=>{
 const p=await make();await settings(p);const c=chord(p,'搜索快捷键');await c.click();
 await p.evaluate(()=>{window.__audit.calls.length=0;window.__audit.wait.test_hotkey_available=80;window.__audit.emit('hotkey-recorded','Alt+G');document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'g',altKey:true,bubbles:true}));window.__audit.emit('hotkey-recorded','Alt+G');});
 await expect(c).toHaveText('Alt + G');expect((await calls(p,'set_search_hotkey')).length).toBe(1);
 expect(await p.evaluate(()=>window.__audit.settings['app.search_hotkey'])).toBe('Alt+G');
});
await run('registration-failure-keeps-current-binding',async()=>{
 const p=await make();await settings(p);const c=chord(p,'搜索快捷键');await c.click();
 await p.evaluate(()=>{window.__audit.fail['set_search_hotkey:']=true;window.__audit.emit('hotkey-recorded','Alt+G');});
 await expect(c).toHaveText('Alt + F');await expect(p.locator('.toast-item')).toContainText('Injected audit rejection');
 expect(await p.evaluate(()=>window.__audit.settings['app.search_hotkey'])).toBe('Alt+F');
});
await run('canonical-conflict-is-rejected-before-probe',async()=>{
 const p=await make();await settings(p);const c=chord(p,'搜索快捷键');await c.click();
 await p.evaluate(()=>{window.__audit.calls.length=0;window.__audit.emit('hotkey-recorded','v+shift+OPTION');});
 await expect(c).toHaveText('Alt + F');await expect(p.locator('.toast-item')).toBeVisible();expect((await calls(p,'test_hotkey_available')).length).toBe(0);
});
await run('switching-recorder-selects-only-latest-field',async()=>{
 const p=await make();await settings(p);
 const rich=chord(p,'带格式粘贴快捷键'), search=chord(p,'搜索快捷键');
 await rich.click();await search.click();await expect(p.locator('.key-group.recording')).toHaveCount(1);
 await expect(search).toHaveClass(/recording/);await p.evaluate(()=>{window.__audit.calls.length=0;window.__audit.emit('hotkey-recorded','Alt+G');});
 await expect(search).toHaveText('Alt + G');await expect(rich).toHaveText('Alt + Shift + V');
 expect((await calls(p,'set_search_hotkey')).length).toBe(1);expect((await calls(p,'set_rich_paste_hotkey')).length).toBe(0);
 await p.evaluate(()=>window.__audit.emit('hotkey-recorded','Alt+H'));
 expect((await calls(p,'set_search_hotkey')).length).toBe(1);
});
await run('cancel-ignores-late-native-recording-event',async()=>{
 const p=await make();await settings(p);const c=chord(p,'搜索快捷键');await c.click();
 await p.evaluate(()=>{window.__audit.calls.length=0;window.__audit.emit('recording-cancelled',null);window.__audit.emit('hotkey-recorded','Alt+G');});
 await expect(c).toHaveText('Alt + F');expect((await calls(p,'set_search_hotkey')).length).toBe(0);
});
for(const theme of ['mica','minimal','graphite'])for(const mode of ['light','dark'])await run(`themed-shortcut-warning-${theme}-${mode}`,async()=>{
 const p=await make(`theme=${theme}&mode=${mode}`); // first theme query is replaced below
 await p.goto(`${base}/tests/ui/index.html?theme=${theme}&mode=${mode}`);await expect(p.locator('.history-item').first()).toBeVisible();await settings(p);
 await chord(p,'搜索快捷键').click();await p.evaluate(()=>{window.__audit.fail['test_hotkey_available:']=true;window.__audit.emit('hotkey-recorded','Alt+G');});
 const toast=p.locator('.toast-item');await expect(toast).toBeVisible();await p.waitForTimeout(220);
 const style=await toast.evaluate(el=>{const s=getComputedStyle(el);return{radius:s.borderRadius,bg:s.backgroundColor,border:s.borderTopWidth};});
 expect(style.radius).toBe({mica:'14px',minimal:'10px',graphite:'6px'}[theme]);expect(style.border).toBe('1px');expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
 await p.screenshot({path:path.join(dir,`shortcut-${theme}-${mode}.png`)});return style;
});
await run('pin-filter-precedes-page-limit',async()=>{
 const p=await make('manyPins=1&pinsOnly=true');await expect(p.locator('.history-item')).toHaveCount(5);
 expect(await p.locator('.history-item').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('普通合成样例')]));
 expect((await calls(p,'get_clipboard_history')).some(c=>c.args.pinnedFilter===false&&c.args.limit===81)).toBe(true);
 await p.getByText('置顶',{exact:true}).click();await expect(p.locator('.history-item').first()).toContainText('置顶合成样例');
 expect((await calls(p,'get_clipboard_history')).some(c=>c.args.pinnedFilter===true)).toBe(true);
 await p.getByPlaceholder('搜索剪切板...').fill('合成样例');await expect.poll(async()=> (await calls(p,'search_clipboard_history')).at(-1)?.args.pinnedFilter).toBe(true);
});
await run('pin-switch-restores-mixed-view-and-persists',async()=>{
 const p=await make('pinsOnly=true');await expect(p.locator('.history-item')).toHaveCount(5);await settings(p);
 const cb=p.getByRole('checkbox',{name:'置顶内容仅在置顶分类显示'});await expect(cb).toBeChecked();await cb.locator('..').click();await expect(cb).not.toBeChecked();
 await expect.poll(()=>p.evaluate(()=>window.__audit.settings['app.pinned_only_in_pinned'])).toBe('false');
 await p.locator('.header-leading > button').click();await expect(p.locator('.history-item')).toHaveCount(6);
});
await run('default-search-and-live-pinned-event-stay-exclusive',async()=>{
 const p=await make('pinsOnly=true');await p.getByPlaceholder('搜索剪切板...').fill('审核样例');await expect(p.locator('.history-item')).toHaveCount(0);
 await expect.poll(async()=> (await calls(p,'search_clipboard_history')).at(-1)?.args.pinnedFilter).toBe(false);
 await p.getByPlaceholder('搜索剪切板...').fill('');await expect(p.locator('.history-item')).toHaveCount(5);
 await p.evaluate(()=>window.__audit.emit('clipboard-updated',{...window.__audit.history[0],id:999,content:'不应混入默认列表',is_pinned:true}));
 await expect(p.locator('.history-item')).toHaveCount(5);
});
await run('fresh-four-defaults-and-pin-default-on',async()=>{
 const p=await make('defaults=new');await expect(p.locator('.history-item')).toHaveCount(5);await settings(p,'常规设置');
 await expect(row(p,'开机自启动').locator('input')).toBeChecked();await expect(row(p,'按键音效').locator('input')).toBeChecked();await expect(row(p,'粘贴音效').locator('input')).toBeChecked();
 await p.locator('.header-leading > button').click();await settings(p);
 await expect(row(p,'持久化存储').locator('input')).toBeChecked();await expect(p.getByRole('checkbox',{name:'置顶内容仅在置顶分类显示'})).toBeChecked();
});
await run('stored-off-defaults-remain-off',async()=>{
 const p=await make('defaults=off');await expect(p.locator('.history-item')).toHaveCount(6);await settings(p,'常规设置');
 await expect(row(p,'开机自启动').locator('input')).not.toBeChecked();await expect(row(p,'按键音效').locator('input')).not.toBeChecked();
 await row(p,'按键音效').locator('label.switch').click();await expect(row(p,'按键音效').locator('input')).toBeChecked();await expect(row(p,'粘贴音效').locator('input')).not.toBeChecked();
 await p.locator('.header-leading > button').click();await settings(p);
 await expect(row(p,'持久化存储').locator('input')).not.toBeChecked();await expect(p.getByRole('checkbox',{name:'置顶内容仅在置顶分类显示'})).not.toBeChecked();
});
for(const mode of ['light','dark'])await run(`rich-preview-colorless-${mode}`,async()=>{
 const p=await make(`rich=1&mode=${mode}`);const rich=p.locator('.synthetic-dark');await expect(rich).toBeVisible();
 const values=await rich.evaluate(el=>{const s=getComputedStyle(el);return{bg:s.backgroundColor,color:s.color,html:el.outerHTML,bold:!!el.querySelector('b'),italic:!!el.querySelector('i'),list:!!el.querySelector('ol'),link:el.querySelector('a')?.getAttribute('href')};});
 expect(values.bg).toBe('rgba(0, 0, 0, 0)');expect(values.bold&&values.italic&&values.list).toBe(true);expect(values.link).toBe('https://example.com');
 expect(values.html).not.toContain('background-color:');await p.screenshot({path:path.join(dir,`rich-${mode}.png`)});return values;
});
await run('rich-cssom-nested-rules-and-snapshot-palette',async()=>{
 const p=await make();return p.evaluate(async()=>{
  const {stripRichTextDocumentColors}=await import('/src/shared/lib/richTextColors.ts');
  const {getRichTextSnapshotDataUrl}=await import('/src/shared/lib/richTextSnapshot.ts');
  const html=`<style>@media screen{.test{color:white!important;background:#08090a;font-size:21px}}.test{font-weight:bold}</style><p class="test" bgcolor="black" style="color:white;background:black;font-style:italic">合成样例</p><ul><li>列表</li></ul>`;
  const doc=new DOMParser().parseFromString(html,'text/html');stripRichTextDocumentColors(doc);
  const result=doc.documentElement.outerHTML;
  if(/(?:^|[;{\s])(?:background(?:-color|-image)?|color)\s*:|bgcolor=/.test(result))throw new Error(result);
  for(const value of ['21px','bold','italic','<ul>'])if(!result.includes(value))throw new Error('Formatting lost: '+value);
  const decode=url=>url.split(',')[0].includes(';base64') ? new TextDecoder().decode(Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0))) : decodeURIComponent(url.slice(url.indexOf(',')+1));
  const light=getRichTextSnapshotDataUrl(html,{palette:{foreground:'#223344',background:'#ffffff'}});
  const dark=getRichTextSnapshotDataUrl(html,{palette:{foreground:'#ddeeff',background:'#101820'}});
  if(!light||!dark||light===dark)throw new Error('Missing palette-specific snapshots');
  const svg=decode(dark);if(!svg.includes('#ddeeff')||svg.includes('#08090a'))throw new Error('Unclean snapshot');
  const table=getRichTextSnapshotDataUrl('<table><tr><th style="color:red;background:black">列</th></tr><tr><td>内容</td></tr></table>',{palette:{foreground:'#ddeeff',background:'#101820'}});
  if(!table||!decode(table).includes('#ddeeff')||decode(table).includes('fill="red"'))throw new Error('Unclean table snapshot');
  return {formattingPreserved:true,paletteCacheSeparated:true};
 });
});
await run('rendered-table-snapshot-refreshes-on-dark-mode-change',async()=>{
 const p=await make('richTable=1&mode=light');
 const img=p.locator('.history-item').filter({hasText:'Synthetic Table'}).getByAltText('rich text preview');
 await expect(img).toBeVisible();const before=await img.getAttribute('src');expect(before).toMatch(/^data:image\/svg/);
 await p.evaluate(()=>{for(const el of [document.documentElement,document.body]){el.classList.remove('light-mode');el.classList.add('dark-mode');}});
 await expect.poll(()=>img.getAttribute('src')).not.toBe(before);
 await expect.poll(()=>img.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
 await p.screenshot({path:path.join(dir,'rich-table-dark.png')});
});
await run('saved-zero-sound-volume-is-not-reset',async()=>{
 const p=await make('defaults=new&volume=0');await settings(p,'常规设置');
 await expect(p.locator('input[type="range"]')).toHaveValue('0');
 expect(await p.evaluate(()=>window.__audit.settings['app.sound_volume'])).toBe('0');
});
await fs.writeFile(path.join(dir,'preferences-results.json'),JSON.stringify(results,null,2));
await browser.close();
console.log(`Preferences: ${results.filter(r=>r.status==='pass').length}/${results.length}`);
if(results.some(r=>r.status==='fail'))process.exitCode=1;
