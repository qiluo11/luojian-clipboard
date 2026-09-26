# TieZ isolated UI regression

Opt-in real React/CSS tests with **synthetic fixtures and mocked Tauri APIs only**.
Never run `tauri dev` for these checks: development and the installed app share a database.
No production entrypoint, application settings, dependency manifest or lockfile is changed by this harness.

From the repository root, after `npm ci`:

```bash
npx playwright install chromium
# Terminal 1: test-only browser server, NOT tauri dev
npm exec vite -- --config tests/ui/vite.config.ts
# Terminal 2: all commands must exit 0
node tests/ui/regression.mjs
node tests/ui/edge.mjs
node tests/ui/themes.mjs
```

- `regression.mjs`: 37 scenarios, including the four originally failing assertions.
- `edge.mjs`: 16 added race/selection, six-theme header, small-height and popover checks.
- Artifacts default to the operating system temporary directory `tiez-ui-regression`.
  Set `TIEZ_TEST_ARTIFACT_DIR` for a custom path; set `TIEZ_TEST_URL` to override the base URL.
- Tests execute all scenarios and save JSON results; **any failed assertion sets exit code 1**.
- The 125%/150% cases model smaller CSS viewports, not native Windows DPI.
- These checks cannot validate native clipboard, NOACTIVATE, tray, hotkeys, startup or real DB behavior.
- The server binds to all interfaces for isolated remote previews; run it only in a trusted test environment.

- `themes.mjs`: 28 menu/toast/dialog, eight-theme light/dark, new theme switching,
  system-mode simulation, dynamic AI-group, scroll/resize/dismiss and failure-toast scenarios.
- The system-mode fixture mirrors the browser color-scheme into the mocked native `theme()`;
  this verifies UI theme application, not Windows native theme-event delivery.
- Run pure placement tests with Node 24: `node --test src/shared/lib/popoverPosition.test.mjs`.
- The favorite rename regression waits for the original first fixture after animated filtering;
  its original post-rename assertion remains unchanged (otherwise it could edit an exiting row).


## 快捷键 / 去颜色 / 置顶分类 / 默认值回归（2026-09-21）

同一个隔离 Vite 服务下运行：

```bash
TIEZ_TEST_ARTIFACT_DIR=/tmp/tiez-preferences node tests/ui/preferences.mjs
node --test src/shared/lib/hotkeyDisplay.test.mjs src/shared/lib/popoverPosition.test.mjs src/shared/lib/webAiDelay.test.mjs
```

新增 23 项：键名、同键无操作、DOM/原生双事件、切换录入目标、取消/迟到事件、失败不更新、别名冲突、三主题双明暗通知、160 个置顶不挤占普通页、开关持久化、搜索/实时事件过滤、新默认与已有 false、富文本行内/样式表去色、保留基本格式、快照调色与主题切换、已有零音量。

`mock.ts` 默认将 `app.pinned_only_in_pinned=false` 作为旧布局用例的显式设置，保留原 81 项断言；新增用例用 `pinsOnly=true` / `defaults=new` 覆盖默认开启，`defaults=off` 覆盖已有关闭。`manyPins`、`rich`、`richTable` 均为合成数据。

此测试仅替换 Tauri 边界，运行真实 React/CSS；不连接真实剪贴板、SQLite、注册表、全局热键或已安装应用。不能代替 Windows/WebView2/DPI/焦点与真实粘贴目标验收。原生 SQL 专项仅使用 `:memory:` 数据库。
