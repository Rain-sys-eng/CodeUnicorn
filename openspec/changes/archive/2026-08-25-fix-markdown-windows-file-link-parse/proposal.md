# Change: fix-markdown-windows-file-link-parse

## Why

用户实证（幕布绿文件链接，Windows，右键 Show in Explorer）：

```
Couldn't open file
Failed to resolve path `/[D:/AI/Alchat/突击队/输出/S9_SE_PANEL_V101_0814_逐物料审计版.md] (codex-file:D:/AI/Alchat/突击队/输出/S9_SE_PANEL_V101_0814_逐物料审计版.md)`: 文件名、目录名或卷标语法不正确。(os error 123)
```

打开动作本身是原生的：`useFileLinkOpener` → Tauri `reveal_in_file_manager` → `explorer /select,`。**不是**内置浏览器 / `http(s)`。失败是因为交给 OS 的已经不是文件路径，而是一段 markdown 链接文本（还被 WebView 按相对 URL 补了前导 `/`）。

既有适配（必须保留）：

- 裸 Windows 路径包装成 `[path](codex-file:urlencoded)`（`normalizeBareWindowsFilePathLinksAround`，含空格路径）
- POSIX `/Users|/Volumes|~/|./` 自动链接
- `file://` / `/D:/` 去头 / UNC
- lightweight `[filename](C:\path)` 直达 opener（`Markdown.file-links.test.tsx`）
- HTML 文件的「在浏览器打开」独立入口
- `rehype-sanitize` 只放行 `codex-file`，**禁止**把盘符 `D:` 加进 protocol 白名单

缺口：模型常写 `[文件名](D:/abs/path.md)`。destination 以 `D:` 开头会被 sanitize 当成未知 protocol 剥掉；若再被包装成 markdown 链接且 `]` 与 `(` 之间出现空格，CommonMark 不再认 link，整段字符串被当成相对 href → `pathname` 变成 `/[D:/...] (codex-file:...)` → `resolveLocalFileHref` 因以 `/` 开头原样放行。

## What Changes

**只加解析规则，不拆既有适配。** 两层都是 additive：

1. **Destination rewrite（sanitize 之前）**  
   已是 markdown link 的 destination 若为 Windows 绝对路径（`D:/` / `D:\`），改写成 `codex-file:` + `encodeURIComponent(path)`，**保留 link text**。  
   禁止再包一层 `[D:/path](codex-file:...)`（那就是本次套娃来源）。  
   已是 `codex-file:` / `file://` / `http(s)` / POSIX 的 destination 原样跳过。

2. **Recovery parse（opener / `resolveLocalFileHref` / `decodeFileLink`）**  
   新增纯函数，识别并剥出真正的 Windows 路径。命中形态包括：
   - `/[D:/path] (codex-file:D:/path)`（报错原样，空格可有可无）
   - `[D:/path](codex-file:urlencoded)`
   - `codex-file:` 前缀 + 上述
   - `/[D:/path]`（posix 误匹配）  
   未命中则 identity，POSIX / 相对 / `file://` / 已干净的 `D:/path` 不变。

## Capabilities

### New Capabilities

- `markdown-local-file-link-open`：幕布（及共用 `MarkdownFileLink` 的表面）本地文件链接的 destination rewrite + garbled href recovery；既有 Windows/POSIX/`file://`/`codex-file` 适配 MUST 保持。

### Non-Goals

- 不把盘符字母（`D:` / `C:`）加入 `rehype-sanitize` href protocol 白名单。
- 不改 `explorer /select` / Finder reveal / `openPath` 的原生打开方式。
- 不把 `.md` 改成「在浏览器打开」。
- 不改 spaced Windows 裸路径包装、POSIX autolink、`file://`、`/D:/` strip、HTML browser action。
- 不重写 lightweight regex 的整体匹配策略（只让它吃到 rewrite 之后的 `codex-file:` 或继续走 recovery）。
- 不处理带空格、未用 `<>` 包裹的 markdown destination（CommonMark 本身在空格处截断；裸空格路径已有包装规则）。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Frontend | `remarkFileLinks.ts`（destination rewrite + recover 纯函数）；`markdownLocalResources.ts`（`resolveLocalFileHref` 接 recover）；`useFileLinkOpener.ts`（normalize/resolve 接 recover，最后一道） |
| 测试 | `remarkFileLinks.test.ts` / `markdownLocalResources.test.ts` / `Markdown.file-links.test.tsx` / `useFileLinkOpener.test.tsx` 补 Windows destination + garbled recovery；既有 POSIX/空格/HTML 用例必须继续绿 |
| 热路径 | 纯字符串规则，仅在链接 normalize / click 时走；无 IPC / 无渲染根链 setState |
| 兼容性 | 未命中 recovery 的路径 identity；不改 `codex-file` 协议名 |

## Acceptance

1. `[S9_....md](D:/AI/Alchat/突击队/输出/S9_....md)` 在 full Markdown（过 sanitize）下右键 Show in Explorer / Open File，OS 收到 `D:/AI/Alchat/突击队/输出/S9_....md`（或等价 `D:\...`），不再 123。
2. 报错原样字符串 `/[D:/...] (codex-file:D:/...)` 经 recover 后同样打开正确文件。
3. 既有用例不回退：裸 Windows 路径（含空格）、POSIX `/Users/...`、`file://`、lightweight `[demo.ts](C:\...)`、HTML 浏览器按钮、`javascript:` 仍被挡住。
4. `openspec validate --strict fix-markdown-windows-file-link-parse` 通过。
