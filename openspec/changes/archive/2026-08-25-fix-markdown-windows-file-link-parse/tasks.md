# Tasks: fix-markdown-windows-file-link-parse

## 1. Recovery 纯函数

- [x] `src/utils/remarkFileLinks.ts`：新增 `recoverLocalFileLinkPath(raw: string): string`（R1–R5，identity 默认；`decodeURIComponent` try/catch）。
- [x] `decodeFileLink`：协议 slice + decode 之后接 `recoverLocalFileLinkPath`；干净 `codex-file:` payload 必须 identity。
- [x] `src/utils/remarkFileLinks.test.ts`：报错原样 `/[D:/x.md] (codex-file:D:/x.md)`、无空格套娃、urlencoded dest、干净 `D:/x.md`、POSIX `/Users/test/a.md`、相对 `src/foo.ts`。

## 2. Destination rewrite（不拆裸路径包装）

- [x] `rewriteWindowsAbsoluteMarkdownLinkDestinations`：只改非 image 的 `[text](WindowsAbs)` dest → `toFileLink(path)`；skip `codex-file:` / `file:` / `http(s)` / `mailto:`；**不改** `previousChar === "("` 的裸路径 skip。
- [x] 插入 `Markdown.tsx` normalize 链：`normalizeBareWindowsFilePathLinksAround` **之后**。
- [x] 单测：`[S9_....md](D:/AI/Alchat/突击队/输出/S9_....md)` dest 变为 `codex-file:` 且 text 不变；`[name](https://example.com/a.md)` 不变；已是 `codex-file:` 不二次编码；`![img](D:/a.png)` 不改（image 仍走既有 `/D:/` img 规则）。

## 3. 接线 opener / resolveLocalFileHref

- [x] `resolveLocalFileHref`：现有绝对/相对判断之前先 `recoverLocalFileLinkPath`。
- [x] `useFileLinkOpener.normalizeLocalFilePath`：`file://` 处理之后接 recover，再走既有 `/D:/` strip。
- [x] 既有 `previousChar === "("` skip、spaced Windows wrap、POSIX autolink **不改语义**。

## 4. 渲染 / opener 回归测试

- [x] `Markdown.file-links.test.tsx`：full Markdown（非 lightweight）`[S9_....md](D:/AI/Alchat/突击队/输出/S9_....md)` click → opener 收到 Windows 绝对路径。
- [x] `useFileLinkOpener.test.tsx`：`showFileLinkMenu` + Reveal 对报错原样字符串调用 `revealInFileManager` 时 path 为 `D:/...md`。
- [x] 跑既有 `Markdown.file-links.test.tsx` 全文件 + `remarkFileLinks.test.ts` + `markdownLocalResources.test.ts`，全部保持绿。

## 5. OpenSpec

- [x] `openspec validate --strict fix-markdown-windows-file-link-parse` 通过。
