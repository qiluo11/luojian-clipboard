// Audit-only Tauri boundary; NEVER connects to a native process or real storage.
const q = new URLSearchParams(location.search);
(window as any).__TAURI_INTERNALS__ = {};
const now = Date.now();
const textRows = [
  ["text", "审核样例：今日待办，核对标签与收藏。", "工作"],
  [
    "url",
    "https://example.com/docs/very-long-path?reference=layout-audit",
    "技术链接",
  ],
  ["code", "npm run build\nconst answer = 42;", "命令"],
  ["text", "只属于标签 A 的内容", "标签A"],
  ["text", "只属于标签 B 的内容", "标签B"],
  ["text", "长文本".repeat(150), "工作"],
];
// ?demo=1：README 截图用的日常示例内容（只影响测试页，不影响默认测试数据）
const demoRows = [
  ["text", "周五下午三点项目评审，记得带上第二版原型和反馈清单。", "工作", "微信"],
  ["url", "https://github.com/qiluo11/luojian-clipboard", "技术链接", "Microsoft Edge"],
  ["code", "npx tauri build --bundles nsis", "命令", "Windows Terminal"],
  ["text", "落笺：让复制与粘贴，保持有序。", "灵感", "记事本"],
  ["text", "晚饭买：番茄、鸡蛋、青菜、豆腐，顺便取快递。", "生活", "微信"],
  ["url", "https://v2.tauri.app/start/", "技术链接", "Microsoft Edge"],
];
let history: any[] = (q.has("demo") ? demoRows : textRows).map(([type, content, tag, app], i) => ({
  id: i + 1,
  content_type: type,
  content,
  preview: content,
  source_app: app || "Audit Fixture",
  timestamp: now - i * 60000,
  is_pinned: i === 0,
  tags: [tag],
  use_count: i,
  pinned_order: i === 0 ? 1 : 0,
  file_preview_exists: true,
}));
if (q.has("manyPins")) {
  history = Array.from({length: 165}, (_, i) => ({...history[0], id: i + 1,
    content: i < 160 ? `置顶合成样例 ${i+1}` : `普通合成样例 ${i+1}`,
    preview: i < 160 ? `置顶合成样例 ${i+1}` : `普通合成样例 ${i+1}`,
    timestamp: now - i, is_pinned: i < 160, pinned_order: 200 - i,
    tags: ["合成标签"]}));
}
// ?manyImages=1：300 条历史，第一页 80 条里只有 2 张图，之后每 4 条 1 张（共 57 张）。
// 用于复现“刚启动时切到图片标签只显示几张”的问题。
if (q.has("manyImages")) {
  const img = "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><rect width="40" height="24" fill="#8ab"/></svg>');
  history = Array.from({length: 300}, (_, i) => {
    const isImg = i < 80 ? (i === 5 || i === 40) : i % 4 === 0;
    const text = `合成文本 ${i + 1}`;
    return {...history[0], id: i + 1, is_pinned: false, pinned_order: 0,
      content_type: isImg ? "image" : "text", is_external: false,
      content: isImg ? img : text, preview: isImg ? `合成图片 ${i + 1}` : text,
      timestamp: now - i * 1000, tags: []};
  });
}
if (q.has("rich")) {
  history.unshift({...history[1], id: 300, content_type: "rich_text", source_app: "Synthetic Editor",
    content: "合成富文本示例：粗体 斜体 链接 列表", preview: "合成富文本示例", is_pinned: false,
    html_content: `<style>.synthetic-dark{color:#fff!important;background:#08090a;font-size:18px;font-weight:bold}</style><div class="synthetic-dark"><b>合成富文本示例</b><i style="color:#eee;background-color:#121314">斜体</i><a href="https://example.com">链接</a><ol><li>有序列表</li></ol></div>`});
}
if (q.has("richTable")) {
  history.unshift({...history[1], id:301, content_type:"rich_text", source_app:"Synthetic Table",
    content:"表格列 内容",preview:"表格列 内容",is_pinned:false,
    html_content:'<table><tr><th style="color:white;background:#08090a">表格列</th></tr><tr><td style="color:white;background:#08090a">内容</td></tr></table>'});
}
// ?demo=1 的“最近打开”演示数据（虚构路径，只用于 README 截图）
const explorerDemo = ([
  ["C:\\Users\\Demo\\Documents\\项目资料", "项目资料", "folder", 2, 23, true],
  ["C:\\Users\\Demo\\Documents\\周报\\第 39 周工作周报.docx", "第 39 周工作周报.docx", "file", 8, 6, false],
  ["C:\\Users\\Demo\\Downloads", "Downloads", "folder", 15, 41, false],
  ["C:\\Users\\Demo\\Pictures\\旅行\\海边日落.jpg", "海边日落.jpg", "file", 34, 3, false],
  ["D:\\Work\\2026 预算表.xlsx", "2026 预算表.xlsx", "file", 60, 12, false],
  ["D:\\Work\\设计稿", "设计稿", "folder", 95, 9, false],
  ["C:\\Users\\Demo\\Desktop\\会议纪要.txt", "会议纪要.txt", "file", 180, 4, false],
  ["C:\\Users\\Demo\\Music", "Music", "folder", 300, 2, false],
] as const).map(([path, name, kind, minsAgo, visits, pinned], i) => ({
  id: i + 1, path, name, kind, last_visited: now - minsAgo * 60000,
  visit_count: visits, is_pinned: pinned, sort_order: 100 - i,
}));
let folders = [
  {
    id: 1,
    name: "工作资料与常用片段".repeat(3),
    sort_order: 0,
    created_at: now,
  },
  { id: 2, name: "代码", sort_order: 1, created_at: now },
];
if (q.get("manyFolders"))
  folders = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    name: `测试长分组 ${i + 1} · ` + "长名称".repeat(12),
    sort_order: i,
    created_at: now,
  }));
let favorites = history
  .slice(0, 3)
  .map((h, i) => ({
    ...h,
    folder_id: 0,
    title: i === 0 ? "收藏长标题".repeat(15) : null,
    created_at: h.timestamp,
    sort_order: 3 - i,
  }));
let settings: Record<string, string> = {
  "app.language": q.get("lang") || "zh",
  "app.compact_mode": q.get("compact") || "false",
  "app.theme": q.get("theme") || "default",
  "app.color_mode": q.get("mode") || "light",
  "app.tag_manager_enabled": "true",
  "app.emoji_panel_enabled": "true",
  "app.sound_enabled": "false",
  "app.sound_paste_enabled": "false",
  // Legacy layout cases explicitly opt out; new cases exercise the default ON.
  "app.pinned_only_in_pinned": q.get("pinsOnly") || "false",
  "app.hotkey": "Alt+C",
  "app.search_hotkey": "Alt+F",
  "app.rich_paste_hotkey": "Alt+Shift+V",
  "app.sequential_hotkey": "Alt+V",
  "app.sequential_mode": "true",
  "app.web_ai_enabled": "true",
  "app.web_ai_prompts": JSON.stringify([
    {
      id: 1,
      name: "DeepSeek 测试提问",
      url: "https://chat.deepseek.com/",
      template: "解释：{content}",
      autoSend: false,
    },
    {
      id: 2,
      name: "另一个相同网站提示",
      url: "https://chat.deepseek.com/new",
      template: "总结：{content}",
      autoSend: false,
    },
  ]),
};
if (q.has("volume")) settings["app.sound_volume"] = q.get("volume")!;
// 检测更新（不联网）：?pendingUpdate=0.9.0 模拟后台已发现新版本；?latest=0.9.0 模拟手动检查结果
const updateInfo = (latest: string) => ({
  current_version: "0.2.0",
  latest_version: latest,
  has_update: latest !== "0.2.0",
  release_url: `https://github.com/qiluo11/luojian-clipboard/releases/tag/v${latest}`,
  release_name: `落笺 ${latest}`,
  notes: "合成的更新说明：\n- 示例条目一\n- 示例条目二",
  published_at: "2026-10-01T00:00:00Z",
});
// ?tagOrder=甲,乙：预设“自定义”标签顺序（只含部分标签，其余应按次数排在后面）
if (q.get("tagOrder")) {
  settings["app.search_tag_sort"] = "custom";
  settings["app.search_tag_order"] = JSON.stringify(q.get("tagOrder")!.split(","));
}
if (q.get("pendingUpdate")) settings["app.update_pending"] = JSON.stringify(updateInfo(q.get("pendingUpdate")!));
if (q.has("defaults")) {
  for (const key of ["app.autostart", "app.sound_enabled", "app.sound_paste_enabled", "app.persistent", "app.pinned_only_in_pinned"]) {
    if (q.get("defaults") === "off") settings[key] = "false";
    else delete settings[key];
  }
}
if (q.get("manyPrompts")) settings["app.web_ai_prompts"] = JSON.stringify(
  Array.from({ length: 30 }, (_, i) => ({ id: i + 1,
    name: `长提示 ${i + 1} · ` + "SyntheticLongName".repeat(5),
    url: "https://example.com/", template: "{content}", autoSend: false }))
);
let colors = {
  工作: "#3979e4",
  技术链接: "#20a080",
  标签A: "#ff8800",
  标签B: "#8866cc",
};
let rules = {};
let delays = {};
const listeners = new Map<string, Set<any>>();
const calls: any[] = [];
const unknown = new Set<string>();
// 局域网文件传输：模拟后端的服务开关和状态事件（不开真实端口）
let fileServer = { enabled: false, port: 0, ip: "" };
const wait: Record<string, number> = {};
const fail: Record<string, boolean> = {};
(window as any).__audit = {
  calls,
  unknown,
  wait,
  fail,
  settings,
  history,
  emit: (event: string, payload: any) => emit(event, payload),
  // 一键更新：测试用 __audit.install.resolve() / reject("原因") 结束 install_update
  install: null as null | { resolve: (v?: any) => void; reject: (e: any) => void },
};
export async function invoke(cmd: string, args: any = {}) {
  calls.push({ cmd, args, time: performance.now() });
  const delay = wait[cmd + ":" + (args.tag || "")] || wait[cmd] || 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  // ?slowImage=毫秒：只让“按图片类型查询”变慢，模拟刚启动时后端较慢
  if (cmd === "get_clipboard_history" && args.contentType === "image" && q.get("slowImage"))
    await new Promise((r) => setTimeout(r, Number(q.get("slowImage"))));
  if (fail[cmd + ":" + (args.tag || "")])
    throw new Error("Injected audit rejection");
  switch (cmd) {
    case "get_settings":
      return { ...settings };
    case "save_setting":
      settings[args.key] = args.value;
      return null;
    case "get_clipboard_history":
      return history
        .filter((h) => (!args.contentType || h.content_type === args.contentType)
          && (args.pinnedFilter == null || h.is_pinned === args.pinnedFilter))
        .slice(args.offset || 0, (args.offset || 0) + (args.limit || 200));
    case "search_clipboard_history":
      return history.filter(h => (args.pinnedFilter == null || h.is_pinned === args.pinnedFilter)
        && (args.tagOnly ? h.tags.some((t: string) => t.includes(args.searchTerm)) : h.content.includes(args.searchTerm)))
        .slice(0, args.limit || 200);
    case "test_hotkey_available": return true;
    case "register_hotkey": settings["app.hotkey"] = args.hotkey; return null;
    case "set_search_hotkey": settings["app.search_hotkey"] = args.hotkey; return null;
    case "set_rich_paste_hotkey": settings["app.rich_paste_hotkey"] = args.hotkey; return null;
    case "set_sequential_hotkey": settings["app.sequential_hotkey"] = args.hotkey; return null;
    case "set_sound_enabled": settings["app.sound_enabled"] = String(args.enabled); return null;
    case "get_display_titles":
      return [];
    case "get_tag_colors":
      return colors;
    case "get_tag_auto_rules":
      return rules;
    case "get_all_tags_info":
      return Object.fromEntries([
        // Opt-in `savedTags`: created tags with no items yet (count 0).
        ...(q.has("savedTags") ? ([["新建标签甲", 0], ["新建标签乙", 0]] as [string, number][]) : []),
        ...[...new Set(history.flatMap((h) => h.tags))].map((t) => [
          t,
          history.filter((h) => h.tags.includes(t)).length,
        ]),
      ]);
    case "get_all_tags":
      return [...new Set(history.flatMap((h) => h.tags))];
    case "get_tag_items":
      return history.filter((h) => h.tags.includes(args.tag));
    case "list_favorites":
      return { folders, favorites };
    case "create_folder": {
      const id = folders.length + 1;
      folders.push({
        id,
        name: args.name,
        sort_order: folders.length,
        created_at: now,
      });
      return id;
    }
    case "rename_folder":
      folders = folders.map((f) =>
        f.id === args.id ? { ...f, name: args.name } : f,
      );
      return null;
    case "rename_favorite":
      favorites = favorites.map((f) =>
        f.id === args.id ? { ...f, title: args.title } : f,
      );
      return null;
    case "remove_favorite":
      favorites = favorites.filter((f) => f.id !== args.id);
      return null;
    case "move_favorite":
      favorites = favorites.map((f) =>
        f.id === args.id ? { ...f, folder_id: args.folderId } : f,
      );
      return null;
    case "get_web_ai_site_delays":
      return { ...delays };
    case "set_web_ai_site_delay": {
      let key = new URL(args.url).host.replace(/^www\./, "");
      if (args.delayMs === null) delete delays[key];
      else delays[key] = args.delayMs;
      return { ...delays };
    }
    case "get_active_file_transfer_path":
    case "get_data_path":
      return "C:\\AuditSyntheticOnly";
    case "scan_installed_apps":
      return [];
    case "is_autostart_enabled":
      return settings["app.autostart"] !== "false";
    case "get_system_default_app":
      return "Synthetic App";
    case "get_file_server_status":
      return { ...fileServer };
    case "toggle_file_server": {
      fileServer = args.enabled
        ? { enabled: true, port: args.port || 12345, ip: "192.168.1.23" }
        : { enabled: false, port: 0, ip: "" };
      settings["file_server_enabled"] = String(!!args.enabled);
      setTimeout(() => emit("file-server-status-changed", { ...fileServer }), 0);
      return null;
    }
    case "get_available_ips":
      return ["192.168.1.23"];
    case "get_chat_history":
      return [];
    case "get_app_logo":
      return "";
    case "get_app_icon":
    case "get_file_icon":
    case "get_source_app_icon":
      return null;
    case "get_explorer_history":
    case "list_explorer_history":
      return q.has("demo") ? explorerDemo : [];
    case "get_pending_update": {
      const raw = settings["app.update_pending"];
      if (!raw) return null;
      const info = JSON.parse(raw);
      return info.latest_version === settings["app.update_skipped_version"] ? null : info;
    }
    case "check_for_update": {
      if (fail["check_for_update"]) throw new Error("network: synthetic failure");
      // 真实后端以字符串拒绝；模拟 GitHub 上没有 latest.json（404）
      if (fail["check_for_update_nojson"])
        throw "网络错误: Could not fetch a valid release JSON from the remote";
      const info = updateInfo(q.get("latest") || "0.2.0");
      if (info.has_update) settings["app.update_pending"] = JSON.stringify(info);
      return info;
    }
    case "install_update":
      return new Promise((resolve, reject) => {
        (window as any).__audit.install = { resolve, reject };
      });
    case "dismiss_update":
      if (args.skip) settings["app.update_skipped_version"] = args.version;
      settings["app.update_pending"] = "";
      return null;
    case "get_emoji_favorites":
      return [];
    case "delete_clipboard_entry":
      history = history.filter((h) => h.id !== args.id);
      return null;
  }
  if (
    /^(set_|activate_window_focus|focus_clipboard_window|warmup_|hide_|toggle_|copy_to_clipboard|paste_favorite|reorder_|open_|web_ai_ask)/.test(
      cmd,
    )
  )
    return null;
  unknown.add(cmd);
  throw new Error("AUDIT_MOCK_UNIMPLEMENTED: " + cmd);
}
export async function listen(name: string, fn: any) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(fn);
  return () => listeners.get(name)?.delete(fn);
}
export async function emit(name: string, payload: any) {
  listeners.get(name)?.forEach((fn) => fn({ event: name, payload, id: 0 }));
}
export async function emitTo(_label: string, name: string, payload: any) {
  return emit(name, payload);
}
export const convertFileSrc = (path: string) =>
  path.startsWith("data:") ? path : "";
export class PhysicalSize {
  constructor(
    public width: number,
    public height: number,
  ) {}
}
export class LogicalSize extends PhysicalSize {}
export class PhysicalPosition {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
export class LogicalPosition extends PhysicalPosition {}
const win = new Proxy(
  {
    label: "main",
    theme: async () => q.get("mode") === "dark" || (q.get("mode") === "system" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light",
    isVisible: async () => true,
    scaleFactor: async () => 1,
    innerSize: async () => new PhysicalSize(innerWidth, innerHeight),
    outerSize: async () => new PhysicalSize(innerWidth, innerHeight),
    outerPosition: async () => new PhysicalPosition(0, 0),
    listen,
  },
  {
    get: (o, k) =>
      k in o
        ? o[k]
        : String(k).startsWith("on")
          ? async () => () => {}
          : async () => null,
  },
);
export const getCurrentWindow = () => win;
export const getCurrentWebview = () => win;
export const currentMonitor = async () => ({
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  scaleFactor: 1,
});
export class WebviewWindow {
  static async getByLabel() {
    return null;
  }
}
export const getVersion = async () => "0.3.12";
export const open = async () => null;
export const ask = async () => false;
export const message = async () => {};
export const openUrl = async () => {};
export const openPath = async () => {};
export const revealItemInDir = async () => {};
export const check = async () => null;
export const relaunch = async () => {};
