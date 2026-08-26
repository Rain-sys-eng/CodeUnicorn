## Context

Git 面板把变更分成「暂存的更改」和「更改（未暂存）」。放弃按钮只出现在未暂存区。用户预期与 VS Code Source Control 一致：

- Stage / Unstage 操作 index
- Discard unstaged 只把 working tree 还原到 index
- 整仓 Revert All 才同时清 index + worktree + untracked

当前实现把 unstaged discard 做成了 `git restore --staged --worktree`，等价于从 HEAD 整文件还原。同一文件部分暂存后再继续编辑时，点未暂存区放弃会把 staged 部分一并丢掉。

## Goals / Non-Goals

- Goal：`revert_git_file` / `revert_git_paths` 只 mutate worktree（+ 必要时 `clean` untracked）。
- Goal：同一文件 mixed state 时，discard unstaged 后 staged hunks 仍可提交。
- Goal：desktop 与 daemon 命令参数保持一致。
- Non-goal：改变 `revert_git_all` 的危险整仓语义。
- Non-goal：新增 command 或改前端 IPC。

## Decisions

### Decision: restore source is the index, not HEAD

Unstaged discard 执行：

```text
git restore --worktree -- <path>
```

失败（常见于 untracked）再：

```text
git clean -f -- <path>
```

禁止带 `--staged`。`git restore --worktree` 默认 source 是 index，所以 mixed file 会回到 staged 内容。

### Decision: keep existing command names

`revert_git_file` / `revert_git_paths` 的全部 caller 都是 unstaged discard（Git panel、worktree history、会话文件卡、Claude rewind fallback）。把它们改成 worktree-only 后，所有入口一起正确，不必新增 API。

`revert_git_all` 继续 `restore --staged --worktree -- .` + `clean -f -d`。

### Decision: confirmation copy must not say HEAD

现有文案「恢复到最近一次提交 / reset to the last commit」描述的是错误实现。改为「恢复到暂存区（若无暂存则回到上次提交）」，避免用户以为会清 staged。

## Risks / Trade-offs

- Claude rewind 的 git fallback 现在也只 restore worktree。这比误清 index 更安全；rewind 本意是丢掉工作区改动。
- 未跟踪文件仍走 `clean -f`，与现状一致，不会把已 staged 的同名路径误删。
- desktop / daemon 必须同步改，否则 remote git 会继续丢 staged。

## Verification

1. Rust test：同一文件 staged+unstaged 后 `restore --worktree` 保留 index。
2. Rust test：仅 unstaged / 仅 untracked / `revert_git_all` 语义不回退。
3. `rg` 确认 desktop 与 daemon 不再对 file/paths revert 使用 `--staged --worktree`。
4. `openspec validate fix-unstaged-discard-preserve-index --strict --no-interactive`。
