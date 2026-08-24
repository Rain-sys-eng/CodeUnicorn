# fix-turn-false-failure-retry-storm — Verification

## 实现对照

| Task | 状态 | 证据 |
| --- | --- | --- |
| 1.1 回归测试先行（红） | ✅ | 3 条新测试先入 `tests_stream.rs`：①② 红（`success result must outrank non-zero exit code: "Claude exited with status: exit status: 1…"`）、③ 绿 |
| 1.2 `saw_success_result` + settle guard | ✅ | `claude.rs`：`is_success_result_event`（`is_error==true` 或 subtype `error*` 不算成功）+ 非零退出 guard 降级 `log::warn!`；`tests_stream` 49/49 绿（单线程复跑同样 49/49） |
| 1.3 其他引擎审计 | ✅ | 结论见下「E2 审计」；Gemini 修复 + 1 条新测试，`engine::gemini` 79/79 绿（连跑 3 次） |
| 2.1 配额分类规则 | ✅ | `classifySharedProviderRetryError.ts`：`classifyPermanent` 顶部 quota 规则（先于 pool 401/403）；正/反用例入测试 |
| 2.2 i18n + hint | ✅ | `providerRetryReasonQuota` zh「配额不足」/ en / ja；`reasonKey` 加 `quota` 臂；`npm run typecheck` 0 error |
| 2.3 identical-failure 熔断 | ✅ | series 加 `failureSignature`/`sameSignatureCount`；`SHARED_PROVIDER_RETRY_CIRCUIT_LIMIT = 3`；3 条新测试（同×3 熔断 / 同同异不熔断 / 熔断后手动发送开新 series） |
| 3.1 质量门 | ✅ | `openspec validate fix-turn-false-failure-retry-storm --strict` ✓；`npm run typecheck` ✓；`vitest run src/features/shared-session/provider-retry` 56/56 ✓（含 collision 套件）；cargo focused 套件绿 |
| 3.2 yuzu 侧 evidence | ⏳ pending（manual） | **证据渠道修正**：仓库未注册任何 log sink（`log::` 生产环境无输出），不存在「`[claude]` 日志行」可抓。改为请 yuzu 在升级前复现时，展开失败轮次的错误详情复制 TurnError 原文（前端 retry overlay `lastMessage` 同源）；若原文是「非零退出 + 空 stderr」则假设闭环，否则回 design.md 补一轮（此时熔断已将损失封在 3 枪内） |
| 3.3 ADR 校准回写 | ✅ | `docs/research/mossx-multi-cli-provider-session-foundation-design.md`「最近校准」+「零、当前实现校准」表新增 2 行（Claude turn settlement / Shared provider retry 分类与熔断），均带文件级事实源 |

## E2 引擎适配器审计结论

| 引擎 | 流内 terminal 概念 | 退出码否决 terminal？ | 处置 |
| --- | --- | --- | --- |
| Claude | `result` 事件 | 是（`claude.rs` ~2355，原注释 "regardless of whether partial output was received"） | **已修**（`saw_success_result` guard） |
| Gemini | `saw_turn_completed`（`{"type":"result","status":"success"}`） | 是（`gemini.rs:1482`，track 了 terminal 但退出码检查不读它） | **已修**（identical inversion） |
| OpenCode | 有（terminal event / quiesce） | 否——`!status.success() && !quiesced_without_terminal` 已带 terminal 守卫 | 不动 |
| Qoder | typed JSON-RPC prompt response（`stopReason`） | 否——settle 路径无 `status.success()` 否决 | 不动 |
| DSH | host RPC typed terminal | 否——`dsh/supervisor.rs:299` 是进程管理非 turn settle | 不动 |
| Kimi / Grok / PI | 无流内 terminal 概念（行流，自建 TurnCompleted） | 不适用——退出码是唯一终态信号，无 terminal 可被否决 | 不动（记录） |

## 测试清点

新增：
- `claude::tests_stream`：`send_message_settles_successfully_when_success_result_arrives_but_process_exits_non_zero`、`send_message_settles_successfully_when_success_result_arrives_with_stderr_noise_and_non_zero_exit`、`send_message_still_fails_when_error_result_arrives_and_process_exits_non_zero`
- `gemini::tests`：`success_result_settles_even_when_process_exits_non_zero`（unix）
- `classifySharedProviderRetryError.test.ts`：`classifies quota-insufficiency as permanent before pool rules`（4 正 2 反）
- `noteSharedProviderRetryTurn.test.ts`：circuit breaker × 3

既有不回归：`send_message_reports_exit_metadata_when_claude_fails_without_output` 等全套；`useThreadsReducer` 引用 resume prompt 的测试不受影响（未改模板文案）。

## 既有失败 / flake 声明（与本 change 无关）

- `engine::claude_history*` 8 条失败：stash 本 change 后在干净树上复现同样失败（如 `filter_tests` 2 条），属既有红。
- `tests_stream::send_message_pending_agent_task_settles_normally_before_result` 与 `send_message_emits_text_delta_before_process_completion`：并行全量跑偶发失败（前者实测 `elapsed=2.022s` vs 断言 `<2s`，纯墙钟预算），单跑 / 单线程全量均绿；本 change 成功路径零新增等待，无语义关联。
- `openspec validate --all --strict` 有 10 个既有 failed item（dsh 系等），本 change 自身校验通过。

## 未覆盖 / 后续

- **Review 追加发现（已修）**：初版只补了 zh/ja/en 三个 locale，`sharedSendLocaleParity` 体系实际有 10 个语言——已补齐 es/fr/hi/ko/pt-BR/ru/zh-TW 的 `providerRetryReasonQuota`；exhausted 文案从 `{{max}}` 改为 `{{n}}`（熔断提前停跑时「已重试 N 次」显示实际次数）。
- **Review 追加发现（记录不改）**：全仓 `log` crate 无 sink（`set_logger` 从未调用，`tauri-plugin-log` 未接），`log::warn!/error!` 生产环境静默丢弃；daemon 仅有 stderr 捕获（`web_service/daemon_bootstrap.rs` → `daemon_stderr.log`）但引擎代码不写 stderr。本 change 新增的 warn 遵循现状；「引擎诊断日志可达性」是独立的平台级债，建议另起 change。
- yuzu 环境 CLI 非零退出的具体来源（Windows / hooks / 中转）未定位——契约修正不依赖定位结果。
- 999 maxAttempts 上限未动（熔断已收敛其风险）。
