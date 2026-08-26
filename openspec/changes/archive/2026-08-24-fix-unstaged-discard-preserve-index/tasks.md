## 1. Backend semantics（P0，无依赖）

- [x] 1.1 输入：`revert_git_file` / `revert_git_paths` desktop + daemon；输出：`git restore --worktree -- <path>`，失败再 `git clean -f -- <path>`；验证：`rg "restore\", \"--staged\", \"--worktree"` 仅剩 `revert_git_all`
- [x] 1.2 输入：同一文件 staged+unstaged fixture；输出：discard 后 worktree=index 且 index 仍含 staged blob；验证：Rust regression test
- [x] 1.3 输入：untracked path 与 `revert_git_all`；输出：untracked 仍被 clean，整仓 revert 仍清 staged+unstaged；验证：Rust tests

## 2. Copy（P1，依赖 1）

- [x] 2.1 输入：Git discard dialog 与会话文件卡确认文案；输出：不再声称恢复到 last commit / HEAD；验证：zh/en 文案审查 + 现有 dialog tests 仍过

## 3. Quality gates（P1，依赖 1-2）

- [x] 3.1 输入：全部实现与测试；输出：focused cargo test + GitDiffPanel discard tests 通过；验证：保存命令结果
- [x] 3.2 输入：OpenSpec artifacts；输出：strict validation 通过；验证：`openspec validate fix-unstaged-discard-preserve-index --strict --no-interactive`
