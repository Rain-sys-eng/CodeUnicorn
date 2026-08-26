# Delta: markdown-local-file-link-open

## ADDED Requirements

### Requirement: Windows Absolute Markdown Destinations MUST Be Rewritten To `codex-file` Before Sanitize

幕布 / 共用 Markdown 在进入 ReactMarkdown（含 `rehype-sanitize`）或 lightweight link 渲染之前，MUST 把非 image markdown link 中的 Windows 绝对路径 destination（`D:/` 或 `D:\`）改写为 `codex-file:` + URL-encoded path，MUST 保留原 link text。

该 rewrite MUST NOT 把 destination 再包成 `[D:/path](codex-file:...)` 套娃。已是 `codex-file:` / `file:` / `http(s)` / `mailto:` 的 destination MUST 原样跳过。裸 Windows 路径的既有包装（`normalizeBareWindowsFilePathLinksAround`，含空格路径、`previousChar === "("` skip）MUST 保持。

#### Scenario: filename link with Windows drive destination survives full markdown sanitize

- **WHEN** assistant Markdown 含 `[S9_SE_PANEL_V101_0814_逐物料审计版.md](D:/AI/Alchat/突击队/输出/S9_SE_PANEL_V101_0814_逐物料审计版.md)`
- **AND** 走 full Markdown 路径（`rehype-sanitize` 生效）
- **THEN** 可见 link text MUST 仍是文件名
- **AND** 点击 / 右键 Open File / Show in Explorer MUST 把 `D:/AI/Alchat/突击队/输出/S9_SE_PANEL_V101_0814_逐物料审计版.md`（或等价反斜杠形式）交给原生 opener
- **AND** MUST NOT 把盘符 `D:` 加入 sanitize protocol 白名单

#### Scenario: existing encoded `codex-file` destination is not double-encoded

- **WHEN** Markdown 已是 `[name](codex-file:D%3A%2Fwork%2Fa.md)`
- **THEN** destination rewrite MUST 跳过
- **AND** opener MUST 仍解码为 `D:/work/a.md`

#### Scenario: http and POSIX destinations stay untouched

- **WHEN** Markdown 含 `[name](https://example.com/a.md)` 或 `[name](/Users/test/a.md)`
- **THEN** destination MUST 不被改成 `codex-file:`
- **AND** 既有外链 / POSIX 打开语义 MUST 保持

#### Scenario: image Windows destinations are not rewritten to `codex-file`

- **WHEN** Markdown 含 `![img](D:/shots/a.png)`
- **THEN** destination rewrite MUST 跳过 image link
- **AND** 既有 local image `/D:/` 规范化 MUST 保持

#### Scenario: bare Windows path wrapping remains

- **WHEN** 正文出现裸路径 `D:\AI\AIchat\突击队\输出\My Deck 修订版.pptx`（含空格）或无空格 `D:\AI\AIchat\突击队`
- **THEN** 既有 `codex-file` 包装 MUST 继续生效
- **AND** `previousChar === "("` 的 skip MUST 保持（禁止套娃包装 destination）

### Requirement: File Link Opener MUST Recover Markdown-Wrapped Windows Hrefs

`decodeFileLink` / `resolveLocalFileHref` / `useFileLinkOpener` 在 canonicalize / `explorer /select` 之前 MUST 运行 `recoverLocalFileLinkPath`。该函数 MUST 从下列形态剥出 Windows 绝对路径，未命中 MUST identity：

- `/[D:/path] (codex-file:D:/path)`（前导 `/` 与 `]` `(` 之间空格均可选）
- `[D:/path](codex-file:urlencoded)`
- 带 `codex-file:` 前缀的上述形态
- `/[D:/path]` 假 POSIX

MUST NOT 把普通 POSIX `/Users/...`、相对 `src/foo.ts`、`https://` 或任意 `[text](url)` 当成 Windows 路径改写。打开方式 MUST 仍是原生 `revealInFileManager` / `openPath`，MUST NOT 改走内置浏览器。

#### Scenario: reported Explorer error string recovers to the real file

- **WHEN** opener 收到 `/[D:/AI/Alchat/突击队/输出/S9_SE_PANEL_V101_0814_逐物料审计版.md] (codex-file:D:/AI/Alchat/突击队/输出/S9_SE_PANEL_V101_0814_逐物料审计版.md)`
- **THEN** recover MUST 得到 `D:/AI/Alchat/突击队/输出/S9_SE_PANEL_V101_0814_逐物料审计版.md`
- **AND** `reveal_in_file_manager` MUST 对该真实路径 canonicalize
- **AND** MUST NOT 再因 os error 123 失败（文件存在的前提下）

#### Scenario: clean Windows and POSIX paths stay identity

- **WHEN** raw path 是 `D:/work/a.md` 或 `/Users/test/a.md` 或 `src/foo.ts`
- **THEN** recover MUST 返回原值（Windows 仅允许既有 `/D:/` strip）
- **AND** POSIX / 相对打开语义 MUST 与改前一致

#### Scenario: lightweight backslash destination still opens

- **WHEN** lightweight Markdown 含 `[demo.ts](C:\Users\test\repo\demo.ts#L3)`
- **THEN** opener callback MUST 仍收到该 Windows 路径（含 `#L3`，由既有 `stripLineSuffix` 处理）
- **AND** 不得被 recovery 吞掉或改成 posix

#### Scenario: javascript urls remain blocked

- **WHEN** Markdown 含 `[bad](javascript:alert(1))`
- **THEN** 渲染 MUST 不产生可点击 `<a href="javascript:...">`
- **AND** recovery MUST NOT 把它变成本地文件打开
