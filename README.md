<div align="center">
  <img src="docs/images/logo.png" alt="落笺 LuoJian" width="128" />

  # 落笺 LuoJian

  **找得更快，用得更顺。**
  <br>
  LESS FRICTION. MORE FLOW.

  [![Version](https://img.shields.io/badge/VERSION-0.1.0-9C27B0?style=for-the-badge)](./NOTICE.md)
  [![License](https://img.shields.io/badge/LICENSE-GPL--3.0-FF9800?style=for-the-badge)](./LICENSE)
  [![Platform](https://img.shields.io/badge/PLATFORM-WINDOWS-2196F3?style=for-the-badge)](#系统要求)
  [![Based on](https://img.shields.io/badge/BASED%20ON-TieZ-4CAF50?style=for-the-badge)](https://github.com/jimuzhe/tiez-clipboard)

  [简体中文](./README.md) | [English](./README.en.md)
</div>

---

落笺是一款 Windows 剪贴板管理工具，由 [七落（qiluo11）](https://github.com/qiluo11) 在开源项目 [**TieZ**](https://github.com/jimuzhe/tiez-clipboard)（作者 LongDz / jimuzhe，GPL-3.0）的基础上修改而来。它保留了 TieZ 的剪贴板记录、标签、主题和隐私脱敏等能力，并在此基础上重点改进了收藏、最近打开、标签整理、网页 AI、快捷键和主题体验。

> 落笺不是 TieZ 官方版本，也与原作者没有隶属关系。原版的问题请到 [TieZ 仓库](https://github.com/jimuzhe/tiez-clipboard) 反馈。

## 主要改动（相对 TieZ 0.3.3）

| 方向 | 落笺的变化 |
| :--- | :--- |
| **收藏** | 独立收藏夹：分组、重命名标题、组内搜索、拖动排序、移动和删除。 |
| **最近打开** | 从资源管理器和“最近使用”采集打开过的文件与文件夹；可搜索、置顶，按时间、次数、名称或手动排序；左键直接打开。 |
| **整理** | 置顶内容可单独成页，不挤占普通历史；标签页适配窄窗口，批量操作单独一行；每个标签可设置正则规则，新内容自动归类。 |
| **网页 AI** | 右键条目 → 选提示词（翻译、总结、润色等，可自定义）→ 打开网页版 AI 并自动粘贴；每个网站可单独设置等待时间，粘贴前核对前台是浏览器。 |
| **右键菜单** | 右键先弹菜单而不是直接粘贴；收藏、网页 AI、属性集中在菜单里，菜单不会超出窗口。 |
| **快捷键** | 显示为可读键名（如 Alt + F）；重新录入更稳定；保存失败时保留原来的绑定。Alt+F 或搜索按钮可随时打开/关闭搜索栏。 |
| **主题** | 从 5 套增加到 8 套（新增现代简约、石墨灰，并继承上游的樱花）；通知和菜单跟随主题。 |
| **启动** | 修复静默启动时窗口闪现；开机自启路径自动修正。 |
| **文件传输** | 保留局域网文件传输，设置里直接显示入口；修好了原版不起作用的“自动关闭服务”、聊天里粘贴图片、切换显示的 IP 和复制下载链接。 |
| **精简** | 移除官方公告、官网推广、在线更新、MQTT/WebDAV 云同步和旧的 API AI（保留网页 AI），安装包更小。 |
| **内存** | 窗口隐藏一段时间后自动降低 WebView2 内存占用，常驻后台更省资源。 |

<p align="center">
  <img src="docs/images/recent-opens.png" width="260" alt="最近打开" /><br>
  <sub>“最近打开”页：最近用过的文件和文件夹，可搜索、置顶、排序，左键直接打开（演示数据）。</sub>
</p>

## 从 TieZ 迁移

- 落笺使用独立的程序标识 `io.github.qiluo11.luojian`，数据保存在 `%APPDATA%\io.github.qiluo11.luojian`，可以和 TieZ 同时安装。
- **第一次启动**时，如果发现 `%APPDATA%\com.tiez` 里有 TieZ 的数据（包括通过 `datapath.txt` 设置的自定义目录），落笺会把数据库、附件、表情收藏和自定义背景**复制**过来。原来的 TieZ 数据不会被移动或删除。
- 导入只进行一次，结果记录在新数据目录的 `legacy-import.txt`。
- 如果不再使用 TieZ，请自行卸载它，以免两个程序同时开机自启。

## 继承自 TieZ 的功能

- 基于 Tauri 2 和 Rust，占用低、响应快。
- 记录文字、富文本、图片、文件和路径；支持全文、来源应用、标签、日期搜索。
- 多色标签、Emoji 面板、贴边收纳、顺序粘贴、外部编辑器编辑。
- 局域网文件传输：手机扫码后在浏览器里和电脑互传文字、图片和文件，手机不用装 App。
- 云母/亚克力背景、深色模式。
- 预览时自动隐藏身份证号、手机号、邮箱等敏感信息。

## 主题

<table>
  <tr>
    <td align="center"><b>便利贴</b><br><img src="docs/images/theme-sticky-note.png" width="200" /></td>
    <td align="center"><b>樱花</b><br><img src="docs/images/theme-sakura.png" width="200" /></td>
    <td align="center"><b>现代简约</b><br><img src="docs/images/theme-minimal.png" width="200" /></td>
    <td align="center"><b>石墨灰（深色）</b><br><img src="docs/images/theme-graphite-dark.png" width="200" /></td>
  </tr>
</table>

以上截图来自落笺 0.1.0 的界面测试页（演示数据）。另有 3D 复古、云母、亚克力、纸质书感等主题，可在设置中切换，并支持浅色/深色模式。

## 系统要求

| 平台 | 要求 | 安装包 |
| :--- | :--- | :--- |
| Windows | Windows 10 / 11（x64） | NSIS 安装程序 `LuoJian_<版本>_x64-setup.exe` |

## 许可证与致谢

- 本项目按 [GNU General Public License v3.0](./LICENSE) 发布。你可以自由使用、修改和再发布，但再发布时必须继续使用 GPL-3.0 并提供完整源码。本程序**不提供任何担保**。
- 原项目：[jimuzhe/tiez-clipboard](https://github.com/jimuzhe/tiez-clipboard)，Copyright (C) 2026 LongDz。
- 修改部分：Copyright (C) 2026 qiluo11。修改从 2026 年 9 月开始，改动摘要和日期见 [`NOTICE.md`](./NOTICE.md)。
- 源码：<https://github.com/qiluo11/luojian-clipboard>
- 感谢 TieZ 原作者及所有贡献者，也感谢 Tauri、React、Rust 社区和其他依赖库的作者；各依赖按各自的许可证使用。
