# Tasks

## 1. 测试先行(TDD red)

- [x] `commands_tests.rs`:cache hit + 非 force → 返回缓存、refresh 闭包未被调用
- [x] `commands_tests.rs`:force → 绕过缓存、返回 fresh、缓存被回写为 fresh
- [x] `commands_tests.rs`:force + fresh 空 → 返回 last-good、缓存未被清空
- [x] `commands_tests.rs`:无缓存 + 非 force → 调 refresh、返回 fresh 并回写缓存
- [x] `commands_tests.rs`:无缓存 + fresh 空 → 返回空,不 panic
- [x] red 确认:编译失败(E0425 helper 缺失 / E0599 `cache_engine_status` 缺失,共 21 错)

## 2. 实现(TDD green)

- [x] `manager.rs` 新增 `pub async fn cache_engine_status(&self, status: EngineStatus)`
- [x] `commands.rs` 新增 `resolve_engine_models_cache_first` helper(refresh 闭包注入)
- [x] Pi arm 改用 helper(闭包 = `detect_pi_status(custom_bin)`)
- [x] Kimi arm 改用 helper(闭包 = `detect_kimi_status(custom_bin)`)
- [x] Grok arm 改用 helper(闭包 = `detect_grok_status(custom_bin)`)
- [x] green 确认:5/5 passed

## 3. 验证

- [x] `rustfmt --edition 2021 --check` 三个改动文件 clean(仅本次 hunk 重排,无存量噪音)
- [x] `cargo test --lib engine::` 模块全量回归(隔离 worktree @ HEAD `29643ab5a` + 本 patch):893 passed / 11 failed;11 个失败经**裸 HEAD 对照实验**证实为存量/环境红(claude_history 解析 8、dsh npm layout、task_output 路径根;gemini 进程树 5 个第二轮自愈,证 flaky),与本 change 零交集。主树回归被并行会话在途改动阻断(`local_usage.rs` 02:53 被删 re-export 未补引用方),采用 worktree 隔离验证
- [x] lens 诊断:改动文件零新增告警(manager.rs 10 个 rust-expect 均为存量)
