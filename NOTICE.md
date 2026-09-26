# NOTICE

落笺 LuoJian is a modified version of TieZ.

- Original work: TieZ — https://github.com/jimuzhe/tiez-clipboard
  Copyright (C) 2026 LongDz and TieZ contributors.
- Modified work: 落笺 LuoJian — https://github.com/qiluo11/luojian-clipboard
  Modifications Copyright (C) 2026 qiluo11.

Both the original and the modified work are licensed under the GNU General
Public License, version 3 (see `LICENSE`). This program is distributed WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE.

## Modifications

qiluo11 modified TieZ (based on TieZ 0.3.3) starting in September 2026 and
released the result as 落笺 LuoJian 0.1.0 on 2026-09-26. Main changes:

- New name, icon and application identifier (`io.github.qiluo11.luojian`),
  with a one-time copy import of existing TieZ data.
- Favorites, a "recently opened" page, pinned-items page, tag rules and tag
  layout, web AI prompts, a right-click context menu, hotkey fixes, new themes
  and a silent-start fix.
- Removed announcements, website promotion, online updates, MQTT / WebDAV
  cloud sync, the API-based AI and the upstream donation links.
- Kept LAN file transfer and fixed its auto-close option and three commands
  that were never registered.
- Lower WebView2 memory use while the window is hidden.

## Third-party software

LuoJian depends on third-party npm packages and Rust crates (see
`package-lock.json` and `src-tauri/Cargo.lock`). Each is used under its own
license. A generated third-party license list is not yet included.

## Compatibility names kept on purpose

Some internal identifiers still contain "tiez" (for example the
`TIEZ_RICH_IMAGE` markers stored in the database and `tiez_*` local storage
keys). They are not shown to users and are kept so existing data stays
compatible.
