# harden-dsh-npm-global-install

## Why

Windows 上一键安装 DSH（`npm install -g @deepseek-ai/dsh@latest`）会在解压传递依赖时打出
`npm warn tar ENOENT: Cannot cd into .../@deepseek-ai/dsh/node_modules/<pkg>`，
随后误报 `tarball ... seems to be corrupted`，并以 Node errno `-4058`（ENOENT）退出。
实测耗时约 170s，贴近原 180s timeout。

根因是 npm 并发解压 + Windows 文件系统 / Defender 竞态，不是包本身损坏。
`@deepseek-ai/dsh` 依赖树比 Codex / Kimi 重（character-entities-*、sharp 等），所以只在 DSH 上高频复现。
macOS 共用同一条命令，APFS 更不容易撞，但同一竞态仍可能发生。

## 目标与边界

### 目标

1. Win / macOS / Linux 的 DSH 一键安装 / 更新 MUST 使用同一条 hardened npm 命令：
   `npm install -g --maxsockets=1 --fetch-retries=5 --no-audit --no-fund @deepseek-ai/dsh@latest`
2. 安装前 MUST 清掉没有 `package.json` 的残留 `@deepseek-ai/dsh` 全局目录；extract-race 失败后 MUST 再清一次并重试一次。
3. DSH 安装 timeout MUST 长于默认 180s（420s），避免重试解压被误杀。
4. 失败文案 MUST 点明 ENOENT / corrupted tarball 是并发解压竞态，并给出可复制的手动命令。
5. Codex / Kimi / OpenCode / Pi 的 npm 命令 MUST 保持原样。

### 边界

- 不改 DSH uninstall（仍故意不支持，保护 `$DSH_HOME`）。
- 不自动 `sudo` / UAC，不改 npm prefix / PATH / 用户 profile。
- 不在首次尝试强制 `npm cache clean --force`。
- 不把 hardened flags 扩散到其他 engine。

## What Changes

| 区域 | 变更 |
|------|------|
| `src-tauri/src/codex/installer.rs` | DSH 命令、timeout、残留清理、extract-race 重试、失败文案 |
| OpenSpec | 本 change；delta `dsh-cli-lifecycle` |

## Impact

- 一键安装对话框的「将执行 / 手动命令」会变长，用户复制到终端也走同一条 hardened 命令。
- DSH 安装可能比以前慢（`--maxsockets=1`），但比失败后空手要好。
- 其他 CLI 供应商安装路径不变。
