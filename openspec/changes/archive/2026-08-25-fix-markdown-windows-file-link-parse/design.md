# Design: fix-markdown-windows-file-link-parse

## 决策

**1. 方案 = 添加解析规则，不是放宽 sanitize、也不是改打开方式。**

用户明确约束：不要破坏之前的 Windows / POSIX / `codex-file` 适配。因此：

- 禁止把 `D` 加进 `rehype-sanitize` `protocols.href`（单字母 protocol 等于给任意 `X:` href 开洞）。
- 禁止改 `reveal_in_file_manager` / `openPath` 的原生打开。
- 禁止拆掉 `normalizeBareWindowsFilePathLinksAround` 的裸路径包装（含空格）。
- 新增规则只在「这已经是 Windows 绝对路径」或「这已经是套娃 markdown」时开火，否则 identity。

**2. 两层规则，职责分开。**

| 层 | 时机 | 作用 |
| --- | --- | --- |
| A. Destination rewrite | Markdown 进 ReactMarkdown / lightweight 之前 | 把 `[text](D:/path)` 的 dest 收成 `codex-file:`，sanitize 不再剥 href |
| B. Recovery parse | `decodeFileLink` / `resolveLocalFileHref` / `useFileLinkOpener.normalizeLocalFilePath` | 历史消息、空格插入、WebView 相对 URL 补 `/` 之后仍能剥出真 path |

A 防新渲染；B 救已坏 href 与历史气泡。两层都是纯函数，可单测，不依赖 workspace。

**3. Destination rewrite：只改 dest，不改 text，禁止套娃。**

当前 `normalizeBareWindowsFilePathLinksAround` 对 `previousChar === "("` 的路径直接 skip——这是对的，避免把 `[name](D:/path)` 变成 `[name]([D:/path](codex-file:...))`。本次**不取消**这个 skip。

另加 `rewriteWindowsAbsoluteMarkdownLinkDestinations(value: string): string`：

- 用既有 markdown link 扫描（与 `normalizeFragmentedResourceReferences` 同类：`/(!?\[[^\]]*]\()([\s\S]*?)(\))/g`，只处理非 image 或 image 同样安全：image dest 走另一条 local image 规则，若 dest 是 Windows 文件路径收成 `codex-file:` 也不破坏打开）。
- dest trim 后若 `isWindowsAbsolutePath`（复用 `WINDOWS_ABSOLUTE_PATH_MATCH` / opener 的 `/^[A-Za-z]:[\\/]/`），且不是 `codex-file:` / `file:` / `https?:` / `mailto:`，则 dest → `toFileLink(stripLineSuffix 不在这里做，保留`#L` fragment 在 path 里，opener 既有 `stripLineSuffix`负责)`。
- dest 已是 `codex-file:` → skip（防止二次 encode）。
- link text 一字不改。所以 `[S9_....md](D:/.../S9_....md)` 显示仍是文件名。

插入点：放在 `normalizeBareWindowsFilePathLinksAround` **之后**（裸路径已变成 `[path](codex-file:enc)`，rewrite 看到 dest 已是 `codex-file:` 会 skip）。不要放进 wrapping 的 `previousChar === "("` 分支里改写成套娃。

**4. Recovery parse：只认「Windows 盘符 + 可选 markdown/codex-file 包装」。**

建议单点 `recoverLocalFileLinkPath(raw: string): string`，放 `src/utils/remarkFileLinks.ts`（与 `decodeFileLink` / `toFileLink` 同文件），由三处调用：

1. `decodeFileLink`：slice 协议 + `decodeURIComponent` 之后
2. `resolveLocalFileHref`：现有 `/` `./` `D:` 判断之前
3. `normalizeLocalFilePath`：`file://` 处理之后、`/D:/` strip 之前或之后都可，但 recover 输出应再走一遍 `/D:/` strip

识别顺序（先精确后宽松，全部不命中则返回 trim 后原值）：

- R1 已是干净 Windows 绝对路径 → identity
- R2 `codex-file:` 前缀 → 去掉前缀再 decode 再递归 recover（防 `codex-file:` + 套娃）
- R3 套娃形态（空格可有可无，前导 `/` 可有可无）：`^/?\[([A-Za-z]:[\\/][^\]]+)\]\s*\(\s*codex-file:([^)]+)\)\s*$`。优先用 group 2：`decodeURIComponent` 后若仍是 Windows 绝对路径则用它；否则用 group 1
- R4 假 POSIX：`^/\[([A-Za-z]:[\\/][^\]]+)\]$` → group 1
- R5 既有 `/^[A-Za-z]:[\\/]/` 的 `/D:/` strip 保持，由 `normalizeLocalFilePath` 继续负责

**刻意不认**：普通 POSIX `/Users/...`、相对 `src/foo.ts`、`https://`、任意 `[text](url)`。避免把合法 markdown 或仓库相对路径吃掉。

**5. 不改 FILE_PATH_PATTERN 的 posix `\/[^\s]+` 分支。**

`/[D:/path.md]` 仍可能被 autolink 成假 POSIX。靠 recovery 在 opener 侧纠正，比收窄 posix matcher 更不容易误伤 `/Users/...` 与 `/tmp/...`。若后续要收窄，另立 change。

**6. 打开方式维持现状。**

- Show in Explorer / Reveal in Finder → `revealInFileManager`
- Open File → `onOpenWorkspaceFile`（工作区内相对路径）否则 `openPath`
- HTML → 独立 `openHtmlInBrowser`  
recovery 只改 `resolvedPath` 字符串，不改 target 选择。

**7. 测试矩阵（既有 + 新增，禁止用新规则替换旧用例）。**

既有必须继续绿：

- 裸 `D:\AI\AIchat\突击队` autolink
- 带空格 `D:\...\My Deck 修订版.pptx` 包装为 `codex-file:`
- POSIX `/Users/test/.../file.rs#L42`
- lightweight `[demo.ts](C:\Users\test\repo\demo.ts#L3)`
- HTML `[index.html](/repo/docs/index.html)` 浏览器按钮
- `javascript:alert(1)` 无 `<a>`

新增：

- full Markdown `[S9_....md](D:/AI/Alchat/突击队/输出/S9_....md)` click / context menu 得到 Windows path
- recover(`/[D:/x.md] (codex-file:D:/x.md)`) === `D:/x.md`
- recover(`[D:/x.md](codex-file:${encodeURIComponent("D:/x.md")})`) === `D:/x.md`
- recover(`/Users/test/a.md`) === `/Users/test/a.md`
- recover(`D:/x.md`) === `D:/x.md`
- destination rewrite 不改 `[name](https://example.com/a.md)`
- destination rewrite 不二次编码 `[name](codex-file:ENC)`

## 风险

- rewrite 的 regex 若写太宽，可能改到 image dest 或脚注。应用 `isWindowsAbsolutePath` 闸，并在 image 路径用既有 `normalizeMarkdownLocalImageSyntax` 对照：Windows 图片 dest 今天会补 `/D:/` 给 `<img>`；rewrite 成 `codex-file:` 会让 img src 变协议。**因此 rewrite 必须跳过 `![...](...)` image links**（pattern 用 `/(?<!!)\[` 或先判断 prefix `![`）。
- `decodeURIComponent` 对残缺 `%` 会抛：recover 必须 try/catch，失败用 bracket 内路径。
- 历史气泡已渲染的坏 href 只靠 B 层；A 层只影响新 normalize。两者都要测。
