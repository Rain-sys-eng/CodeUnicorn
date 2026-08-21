# Learnings

## [LRN-20260822-001] user_feedback

**Logged**: 2026-08-22T00:55:33+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
设置页 Dialog 通过 Portal 挂到 body 后，拿不到 `.settings-section-basic` 的 `--settings-basic-*` token；深色主题会掉回浅色 fallback。

### Details
「选择壁纸」弹层用 `var(--settings-basic-surface, #fff)`，但 `DialogContent` 是 Radix Portal，不在 `.settings-section-basic` 内。token 未定义时回退 `#fff`，标题/分段按钮/隐藏/导入也因为选择器写了 `.settings-section-basic .settings-pref-segment` 而没样式。同类已修好的是 `.settings-open-app-dialog`：弹层自己写实色 `#ffffff` / `#1c1c1e`。

### Suggested Action
设置弹层必须自带实色 surface 与内部控件样式，禁止依赖父级 `.settings-section-basic` token，禁止 `color-mix(..., transparent)` 当弹层底。

### Metadata
- Source: user_feedback
- Related Files: src/styles/settings.part2.basic-redesign.css, src/features/theme/components/WorkspaceWallpaperPicker.tsx
- Tags: theme, dialog, portal, wallpaper, dark-mode

### Resolution
- **Resolved**: 2026-08-22T00:55:33+08:00
- **Notes**: Wallpaper picker dialog now owns opaque light/dark surfaces (`#ffffff` / `#1c1c1e`) and restyles segmented tabs, buttons, and reset links inside the portal.

---

## [LRN-20260821-002] user_feedback

**Logged**: 2026-08-21T17:20:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
深色模式下次级文字不能停在中灰（#808080 / rgb(115,115,115)），叠壁纸会发闷；应走亮、略暗的 ink。

### Details
侧栏分组、思考行、composer placeholder / toolbar 看起来像同一套灰，但实际分散在 `--text-faint`、`--color-thinking-text`、`--muted-foreground`、ChatInputBox `--input-placeholder`（还混了透明）和 lazy-loaded `--color-tool-summary: #888`。只改一行不够。浅色阶梯不要跟着抬。

### Suggested Action
改 `themes.dark.css` 的 muted/faint 阶梯，并把 thinking / composer / tool-summary 接回 `--text-faint`。浅色 token 保持原对比。

### Metadata
- Source: user_feedback
- Related Files: src/styles/themes.dark.css, src/features/composer/components/ChatInputBox/styles/variables-bridge.css, src/styles/tool-blocks.css
- Tags: theme, wallpaper, muted-foreground, dark-ink

### Resolution
- **Resolved**: 2026-08-21T17:20:00+08:00
- **Notes**: Dark secondary ink lifted to #b4b4b4 / #c8c8c8; composer placeholder no longer mixes extra transparency.

---

## [LRN-20260821-001] user_feedback

**Logged**: 2026-08-21T16:36:56Z
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
首页 composer 下方的工作区选择器会被一条空的 `composer-branch-row` 撑开。

### Details
`Composer` 在 `selectedEngine === "dsh"` 时无条件渲染 `.composer-branch-row`（`min-height: 28px`）。首页把分支/用量指示器交给 `HomeChat` 自己渲染，并关闭 `footerUsageIndicatorEnabled`，但 DSH 条件仍会留下空行。`DshSessionStatsLine` 在无 session stats 时返回 `null`，空壳高度却还在。Home 工作区选择器原先还有 `margin-top: 10px`，叠加后空隙更明显。

### Suggested Action
分支行只在有真实内容时渲染：branch badge、footer usage、shared collab slot，或 `deriveDshSessionStatsLine(usage) != null`。首页工作区选择器贴近 composer，不要预留会话态 footer 间距。

### Metadata
- Source: user_feedback
- Related Files: src/features/composer/components/Composer.tsx, src/styles/home-chat.css, src/features/composer/components/Composer.context-dual-view.test.tsx
- Tags: homepage, composer, dsh, empty-row

### Resolution
- **Resolved**: 2026-08-21T16:36:56Z
- **Notes**: Homepage create-session DSH path no longer mounts an empty branch row; meta spacing tightened to 4px.

---

## [LRN-20260817-009] user_feedback

**Logged**: 2026-08-17T22:55:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
开启背景后，侧栏「新建会话」菜单会被 Home 输入框盖住。

### Details
`SidebarWorkspaceMenuOverlay` 虽然是 `position:fixed; z-index:1200`，但挂在 `.sidebar` 里。壁纸打开后 `.app` 有 `position:relative; z-index:1`，菜单的 1200 被困在这个 stacking context 里。`.main` / Home composer 是后画的兄弟层，就能盖住菜单。

### Suggested Action
侧栏浮动菜单（workspace menu、folder move picker）必须 `createPortal(..., document.body)`，和 `RendererContextMenu` 一样。不要只靠 sidebar 内的 z-index。

### Metadata
- Source: user_feedback
- Related Files: src/features/app/components/SidebarWorkspaceMenuOverlay.tsx, src/features/app/components/SidebarFolderMovePicker.tsx
- Tags: wallpaper, stacking, portal, sidebar-menu

### Resolution
- **Resolved**: 2026-08-17T22:55:00+08:00
- **Notes**: Both overlays now portal to document.body.

---

## [LRN-20260817-008] user_feedback

**Logged**: 2026-08-17T22:32:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
开启流体/自定义背景后，主面板会压住侧栏右缘（项目行 `+` 被圆角白卡片裁掉）。

### Details
`WorkspaceWallpaperHost` 是 `#root` 里 `.app` 的 sibling。sidebar / `.main` 开 wallpaper 时各自挂 `backdrop-filter` 会建 stacking context；WebKit 还会按 blur 半径把 frost 向外扩，后画的 `.main` 圆角白边盖住项目行 `+`。只改 z-index 不够。

### Suggested Action
1. 毛玻璃只挂在 `.workspace-wallpaper::after`，chrome 列 `backdrop-filter: none`。
2. `:root[data-workspace-wallpaper]` 上直接把 `--desktop-main-radius` 清零，`.main` / `.home-chat` 用 `border-radius: 0 !important`。
3. `.app` 抬到 `z-index:1`，sidebar 再高于 `.main`。不要把壁纸设成 `z-index:-1`（`#root { overflow:hidden }` 会裁掉）。

### Metadata
- Source: user_feedback
- Related Files: src/styles/workspace-wallpaper.css, src/features/theme/components/WorkspaceWallpaperHost.tsx, src/router.tsx
- Tags: wallpaper, stacking, sidebar, backdrop-filter

### Resolution
- **Resolved**: 2026-08-17T22:32:00+08:00
- **Notes**: Frost moved to wallpaper `::after`. Chrome columns no longer create backdrop-filter stacking contexts. Radius forced to 0.

---

## [LRN-20260817-007] user_feedback

**Logged**: 2026-08-17T20:33:20+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
DSH 会话侧栏会一直停在 `Agent N`，即使画布里已经有完整用户首条消息。

### Details
`ensureThread` 给新会话的默认名是 `Agent ${list.length + 1}`。DSH 列表标题常被 runtime context 洗成空串或 `DSH Session`，历史灌入走 `setThreadItems` / `prependThreadItems` 又不改名。pending → `dsh:` 换绑时弱标题还会盖掉已经从首条消息生成的好名字。

### Suggested Action
1. 历史灌入和 prepend 时，用首条真实用户消息升级弱标题。
2. 忽略 DSH runtime context / goal injection，不要拿它们当标题。
3. pending 换绑和 DSH list merge 都要保留更强的已有标题。

### Metadata
- Source: user_feedback
- Related Files: src/features/threads/hooks/threadReducerThreadNaming.ts, src/features/threads/hooks/useThreadsReducer.ts, src/features/threads/hooks/threadReducerThreadIdentity.ts, src/features/threads/hooks/useThreadActions.helpers.ts, src/features/threads/utils/sessionDisplayProjection.ts
- Tags: dsh, sidebar, thread-title, agent-n

### Resolution
- **Resolved**: 2026-08-17T20:33:20+08:00
- **Notes**: Weak `Agent N` / `DSH Session` titles now upgrade from the first real user prompt on live upsert, history hydrate, prepend, pending rebind, and DSH list merge.

---

## [LRN-20260817-006] user_feedback

**Logged**: 2026-08-17T19:17:54+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
思考区展开后段落之间空得太开，用户觉得「很多回车分隔」，观感不好。

### Details
User circled the large gaps inside a live thinking block (paragraph → “I’ll update 3 places:” → numbered items). This is mixed: reasoning models often emit one short sentence per blank-line paragraph, and our UI then amplifies it.

Two UI amplifiers:
1. `.reasoning-markdown > * + * { margin-top: 10px }` is overridden by later `.markdown > * + * { margin-top: 1.5em }` (same specificity). At 11px thinking font, that is ~16.5px plus list `margin: 0.4rem 0`.
2. Live lightweight parser flushes lists on a blank line, so `1. / 2. / 3.` with empty lines become three separate `<ol>` that all start at `1.` and each take a full paragraph gap.

Existing fragment normalizers only merge very short CJK shards (≤14 chars, ≥5 run), not ordinary English planning paragraphs.

### Suggested Action
Tighten thinking-only spacing (restore compact gap, beat `.markdown > * + *`), and optionally keep loose numbered lists as one list in lightweight mode. Do not collapse assistant body the same way.

### Metadata
- Source: user_feedback
- Related Files: src/styles/messages.part2.css, src/features/messages/rows/components/ReasoningRow.tsx, src/markdown/runtime/LiveMarkdown.tsx
- Tags: thinking, spacing, markdown, live-render

### Resolution
- **Resolved**: 2026-08-17T19:27:00+08:00
- **Notes**: Thinking markdown now uses a more specific 0.4em gap so it beats `.markdown > * + * { 1.5em }`. Lightweight parser keeps loose numbered/bulleted items in one list across blank lines.

---

## [LRN-20260817-005] correction

**Logged**: 2026-08-17T02:50:47+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
First-run uninstalled engine rows must install only from the explicit 安装 button, never from clicking the row/tab.

### Details
User clicked the PI CLI row and it started installing. They want the install chip to be a deliberate action. The row used a hover/selected swap: `.first-run-engine-block.is-missing:hover` and `.is-selected` hide「未安装」and reveal an absolutely positioned「安装」chip over the same hit target. Clicking the tab/right side of the row therefore fires install.

### Suggested Action
Always show a static 安装 chip on missing engines. Row/card click only selects. Remove the hover/selected overlay swap.

### Metadata
- Source: user_feedback
- Related Files: src/features/onboarding/components/FirstRunCliStep.tsx, src/styles/first-run-setup.css, src/features/onboarding/components/FirstRunCliStep.test.tsx
- Tags: onboarding, engines, install
- See Also: LRN-20260817-002

### Resolution
- **Resolved**: 2026-08-17T02:55:00+08:00
- **Notes**: Missing engine rows now always show a static 安装 chip. Card/row click only selects; install runs only from the chip.

---

## [LRN-20260817-004] correction

**Logged**: 2026-08-17T02:13:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
CLI onboarding footer needs a short skip-and-enter action next to Back, even after an engine is validated.

### Details
User circled the empty space beside 返回 and asked for “稍后安装，直接进入”, with shorter copy. After validation, the primary button becomes 验证通过，继续 and the old skip action disappears from the footer.

### Suggested Action
Keep a persistent text action `稍后再装` / `Install later` next to Back on the CLI step. It should call the existing skip handler and enter the app immediately.

### Metadata
- Source: user_feedback
- Related Files: src/features/onboarding/components/FirstRunSetupWizard.tsx, src/i18n/locales/zh/onboarding.ts, src/i18n/locales/en/onboarding.ts
- Tags: onboarding, engines, skip
- See Also: LRN-20260817-002

### Resolution
- **Resolved**: 2026-08-17T02:13:00+08:00
- **Notes**: Footer now shows 返回 + 稍后再装 on the CLI step.

---

## [LRN-20260817-003] correction

**Logged**: 2026-08-17T02:05:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
First-run engine rows should show a short version number, not the raw CLI string with product suffix.

### Details
User circled the truncated `版本 2.1.228 (Claude Co...` label and asked to keep version info on the same row without the long text. The raw detect/validate string includes `(Claude Code)` / `codex-cli`, and CSS `max-width: 9rem` plus ellipsis cut it off.

### Suggested Action
Reuse `formatEngineVersionLabel` so the row shows `版本 2.1.228`. Show the short version for every installed engine, not only the selected one. Do not ellipsis a short version.

### Metadata
- Source: user_feedback
- Related Files: src/features/onboarding/components/FirstRunCliStep.tsx, src/styles/first-run-setup.css, src/features/engine/utils/engineLabels.ts
- Tags: onboarding, engines, version
- See Also: LRN-20260817-002

### Resolution
- **Resolved**: 2026-08-17T02:05:00+08:00
- **Notes**: Short version on every installed engine row.

---

## [LRN-20260817-002] correction

**Logged**: 2026-08-17T01:45:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
First-run CLI step felt bulky: two large cards plus long marketing hints. Default list should be five compact engine rows.

### Details
User asked to default-show Claude Code, Codex, DeepSeek Harness, Kimi CLI, and OpenCode, and said the current cards occupied too much space. Primary list was only `claude` + `codex`; selected engine expanded into a second block with version + action. Marketing hints made every row two lines.

### Suggested Action
`FIRST_RUN_PRIMARY_ENGINES` = `claude`, `codex`, `dsh`, `kimi`, `opencode`. Keep `grok` / `pi` behind “更多引擎”. Compact engine rows: title + status on one line, version truncated inline, Install/Test on the same row. Do not nest buttons inside the choice card.

### Metadata
- Source: user_feedback
- Related Files: src/features/onboarding/types.ts, src/features/onboarding/components/FirstRunCliStep.tsx, src/styles/first-run-setup.css
- Tags: onboarding, engines, density

### Resolution
- **Resolved**: 2026-08-17T01:45:00+08:00
- **Notes**: Default five engines; compact single-row layout.

---

## [LRN-20260817-001] correction

**Logged**: 2026-08-17T01:39:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
Onboarding IDE step should only offer VS Code, Cursor, and IntelliJ; the previous IntelliJ glyph was a fake three-bar placeholder, not the official IJ product icon.

### Details
User reviewed the first-run editor picker and asked to keep only three choices. They also flagged that the IntelliJ icon looked wrong. The built-in fallback was a black rounded square with three magenta bars (`IDEA_SVG`), which reads more like a generic hamburger/menu mark than JetBrains' current "IJ + underscore" product icon. VS Code / Cursor already used official PNGs under `src/assets/app-icons/`.

### Suggested Action
Keep onboarding choices in `FIRST_RUN_IDE_CHOICES` (`vscode`, `cursor`, `idea`). Retain retired ids (`zed`, `sublime`, `none`) in `FIRST_RUN_IDES` so existing profiles still normalize. Use the official IntelliJ product icon (`src/assets/app-icons/idea.png`, exported from `/Applications/IntelliJ IDEA.app/Contents/Resources/idea.icns`) as `IDEA_APP_ICON`.

### Metadata
- Source: user_feedback
- Related Files: src/features/onboarding/types.ts, src/features/onboarding/components/FirstRunSetupWizard.tsx, src/features/app/utils/openAppIcons.ts, src/assets/app-icons/idea.png
- Tags: onboarding, icons, intellij

### Resolution
- **Resolved**: 2026-08-17T01:39:00+08:00
- **Notes**: Wizard now lists only the three editors; IntelliJ uses the official 256px product icon.

---
