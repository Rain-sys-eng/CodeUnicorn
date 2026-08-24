# fix-turn-false-failure-retry-storm — Tasks

## 1. 引擎层（Bug A 断根）

- [x] 1.1 回归测试先行（红）：fake CLI 脚本 emit 成功 `result` 后 `exit 1`
  - 输入：`src-tauri/src/engine/claude/tests_stream.rs`（复用 `create_fake_claude_script` harness）
  - 输出：2 条新测试——① `result(success)`+`exit 1`+空 stderr → 期望 Ok + 恰好一次 `TurnCompleted` + 零 `TurnError`；② `result(success)`+`exit 1`+stderr 噪声 → 同上；另钉 ③ `result(is_error=true)`+`exit 1` → 仍 Err/TurnError
  - 验证：`cargo test --manifest-path src-tauri/Cargo.toml claude::tests_stream` ①② 红、③ 绿（确认测试能区分）
  - 依赖：无；优先级 P0

- [x] 1.2 实现 `saw_success_result` + settle guard（转绿）
  - 输入：`src-tauri/src/engine/claude.rs`（流循环 ~2088 `result_seen_at` 处、~2355 `!status.success()` 块）
  - 输出：成功 `result`（`is_error != true` 且 subtype 非 `error*`）后进程非零退出 → `log::warn!`（含 status + stderr sample 截断）→ 走既有 `TurnCompleted` 路径；其余分支零改动
  - 验证：1.1 全绿 + 既有 `send_message_reports_exit_metadata_when_claude_fails_without_output` 等不回归；`rustfmt --edition 2021` 仅格式化本文件改动区
  - 依赖：1.1；优先级 P0

- [x] 1.3 其他引擎适配器同款审计
  - 输入：`gemini.rs:1482`、`kimi.rs:598`、`grok.rs:906`、`opencode.rs:715`、`pi.rs:1720`、`qoder.rs`、`dsh/`
  - 输出：verification.md 记录每引擎两问结论（有无 terminal 概念 / 退出码是否否决）；仅对 identical inversion 修复并补测试，其余不动
  - 验证：审计结论落盘；若有修复则对应引擎 cargo test 绿
  - 依赖：1.2；优先级 P1

## 2. 重试层（Bug B 防爆）

- [x] 2.1 分类器配额规则（R1）
  - 输入：`src/features/shared-session/provider-retry/classifySharedProviderRetryError.ts`
  - 输出：`SharedProviderRetryKind` + `"quota"`、reason `"配额不足"`；`classifyPermanent` 顶部配额规则（先于 pool）；正反测试入 `classifySharedProviderRetryError.test.ts`
  - 验证：`npx vitest run src/features/shared-session/provider-retry/classifySharedProviderRetryError` 绿
  - 依赖：无；优先级 P0

- [x] 2.2 `quota` kind 的 i18n 与 hint 渲染
  - 输入：`SharedProviderRetryHint.tsx`（`reasonKey` switch）、`src/i18n/locales/{zh,ja,en}/sharedSend.ts`
  - 输出：`providerRetryReasonQuota` 三语词条 + switch 臂；permanent overlay 正确显示「配额不足」
  - 验证：`npm run typecheck`；hint 相关 vitest 不回归
  - 依赖：2.1；优先级 P0

- [x] 2.3 identical-failure 熔断（R2）
  - 输入：`noteSharedProviderRetryTurn.ts`、`providerRetryControllerStore.ts`、`classifySharedProviderRetryError.ts`（导出 signature helper）
  - 输出：series 增加 `failureSignature` / `sameSignatureCount`；连续 3 次同签名 → `exhausted` 停跑；测试入 `noteSharedProviderRetryTurn.test.ts`（同×3 熔断 / 同同异不熔断 / 手动发送后状态清理）
  - 验证：`npx vitest run src/features/shared-session/provider-retry/noteSharedProviderRetryTurn` 绿
  - 依赖：无（与 2.1 并行）；优先级 P1

## 3. 收口

- [x] 3.1 质量门全量
  - 输入：以上全部改动
  - 输出：`openspec validate --all --strict --no-interactive`、`npm run typecheck`、focused vitest、`cargo test` 四绿
  - 验证：命令输出留档
  - 依赖：1.x、2.x；优先级 P0

- [ ] 3.2 （manual，可 waiver）yuzu 侧 evidence（**pending**：证据渠道已修正——仓库无 log sink，`[claude]` 日志行不存在；改为请 yuzu 升级前复现并复制失败轮次的 TurnError 原文，详见 verification.md；archive 前若未取得按 waiver 注明）
  - 输入：yuzu 提供该时间窗应用日志 `[claude]` 行
  - 输出：verification.md 记录 TurnError 原文，确认/修正「非零退出 + 空 stderr」假设；若原文是别的（如 daemon 传输错误），回 design.md 补一轮
  - 验证：日志行原文引用
  - 依赖：无（可与实现并行）；优先级 P1

- [x] 3.3 ADR 校准回写 + sync + index
  - 输入：本 change 全部 artifacts
  - 输出：`docs/research/mossx-multi-cli-provider-session-foundation-design.md`「最近校准」+「零、当前实现校准」表回写（引用本 change id 与 `claude.rs` 事实源）；main specs sync；`openspec/changes/README.md` 状态更新
  - 验证：ADR gate 检查通过后方可 archive
  - 依赖：3.1；优先级 P0
