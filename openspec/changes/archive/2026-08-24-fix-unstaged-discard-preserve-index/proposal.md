## Why

Git 面板「更改 / 未暂存」区的放弃按钮语义应对齐 VS Code：只丢 working tree 未暂存改动。当前 `revert_git_file` / `revert_git_paths` 执行 `git restore --staged --worktree`，同一文件同时有 staged + unstaged 时会把 index 也清掉，用户已暂存的内容一起丢失。这是 P0 数据损失。

## What Changes

- `revert_git_file` / `revert_git_paths`（desktop + daemon）改为 `git restore --worktree -- <path>`，失败时仍 `git clean -f -- <path>` 处理未跟踪文件。
- 同一文件既有 staged 又有 unstaged 时，放弃未暂存后 index 必须保持，工作区回到 index 内容，而不是 HEAD。
- 确认文案改为「恢复到暂存区/index」，不再写「恢复到最近一次提交」。
- `revert_git_all` 保持整仓清空（staged + unstaged + untracked），不受本修复影响。

## 目标与边界

- 目标：未暂存区 discard 只回滚 worktree，保留 staged hunks。
- 边界：复用现有 command 名与 UI 入口，不新增 IPC。desktop 与 daemon 必须同语义，避免 remote git 漂移。

## 非目标

- 不给 staged 区加 discard。
- 不改 `unstage_git_*`、`revert_git_all`、hard reset、stash。
- 不改 Claude rewind 的调用面；它继续走 `revert_git_file`，语义变为 worktree-only restore，对 rewind fallback 更安全。

## 技术方案取舍

- 方案 A（采用）：把 unstaged discard 的 restore source 从 HEAD 改为 index（`--worktree` only）。符合 Git / VS Code 分层语义，改动面最小。
- 方案 B（不采用）：前端按文件是否同时 staged 分支调用不同 command。UI 已只在 unstaged 区暴露 discard，分支会制造 drift。
- 方案 C（不采用）：新增 `discard_unstaged_*` command。无必要，现有 `revert_git_file/paths` 本来就只服务 unstaged discard。

## 验收标准

- 同一文件 staged=`foo`、workdir=`bar` 时，`revert_git_file` 后 workdir=`foo`，index 仍为 `foo`，文件仍出现在 staged 列表。
- 仅 unstaged 修改时，discard 后该文件干净。
- 未跟踪文件 discard 后仍被 `clean -f` 删除。
- `revert_git_all` 仍同时清 staged 与 unstaged。
- desktop 与 daemon 命令参数一致。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `git-panel-diff-view`: unstaged discard 只恢复 working tree 到 index，不得清空 staged changes。

## Impact

- Backend：`src-tauri/src/git/commands.rs`、`src-tauri/src/bin/cc_gui_daemon/git.rs`、Rust regression tests。
- Frontend copy：Git discard dialog 与会话文件卡确认文案。
- 无 IPC / frontend callback 签名变更。
