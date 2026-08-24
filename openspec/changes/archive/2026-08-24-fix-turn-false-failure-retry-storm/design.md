# fix-turn-false-failure-retry-storm — Design

## 0. 证据链（数据事实源）

样本：yuzu 提供 `~/.claude/projects/S--AIWorker-M365-Copilot-Proxy-docker-multi/`（Windows，`S:\` 路径；CLI version `2.1.233`，`entrypoint: sdk-cli`）。

| 事实 | 证据 |
| --- | --- |
| auto-resume 打在正常完成的轮次上 | `01086fe3…jsonl`：~49 条「继续。上一轮因供应商暂时失败中断」user 消息，前一轮 assistant 全部 `stop_reason=end_turn`；`4c128971` 8/10、`9e3951c9` 4/7、`acc34b1c` 5/7 同型；6 个文件合计 0 条打在 `isApiErrorMessage` 之后 |
| 工具未被掐死 | `01086fe3` 138 个 tool_use 全部有 tool_result，dangling = 0 |
| 失败非上游 API 错误 | `01086fe3` 全文件 0 条 `isApiErrorMessage` |
| mossx 失败行与 transcript 同轮 | 截图「06:29:34 耗时0s · 输入 138.4K / 输出 0」↔ jsonl 22:29:34Z assistant `cache_read=138187`，文本逐字一致 |
| 循环烧上下文直至 auto-compact | 22:29–22:30 每 7~10s 一枪，`cache_creation` 20.5K→24.6K 单调涨；22:33:02 "This session is being continued from a previous conversation that ran out of context" |
| 真实配额失败存在但稀少 | `da519ed6` 00:20：`Failed to authenticate. API Error: 403 预扣费额度失败, 用户剩余额度: ＄0.378004, 需要预扣费额度: ＄0.800000`；00:22 `Prompt is too long · automatic compaction failed: 403…` |
| 既有其他上游错误形态 | 502（Cloudflare 空壳）、524 timeout、503 no available accounts、429 concurrency —— 均 retryable，分类正确 |

未证实环节（manual evidence task）：mossx 侧 TurnError 消息原文。头号假设：`Claude exited with status: … No stdout/stderr diagnostics were observed.`（`build_process_exit_error` 空 stderr 分支），与「耗时0s / 输出0 / 正文已显示」完全自洽。备选：daemon 传输层假失败。一行 `[claude]` 日志即可区分。

## 1. E1 引擎结算修正（Claude）

### 现状代码事实

`src-tauri/src/engine/claude.rs`：

- 流读取循环在 `2088` 行对任意 `type == "result"` 事件设置 `result_seen_at`，**不区分 subtype / is_error**。
- 循环结束后（~2305 起）等待进程退出，~2355：`if !status.success() { … build_process_exit_error … emit TurnError … return Err }`——注释明确写 "regardless of whether partial output was received"（原意为防「有半截输出但崩溃」的静默失败）。
- `settled_by_grace`（post-result grace 强杀）路径已豁免 status 检查（status=None）。
- 成功路径在 ~2478 发 `TurnCompleted`。

### 改动

1. 循环内新增 `saw_success_result: bool`：`type == "result"` 且 `event.get("is_error").and_then(Value::as_bool) != Some(true)` 且 `subtype` 不以 `"error"` 开头时置真（覆盖 `subtype: "success"` 与缺省 subtype 两种形状）。
2. ~2355 `!status.success()` 块入口处加 guard：

```rust
if saw_success_result {
    log::warn!(
        "[claude] turn={} completed with success result but process exited non-zero ({}); treating as completed. stderr_sample={}",
        turn_id, status, /* truncated error_output */
    );
    // fall through：不 emit TurnError，不 return Err
} else { /* 现有失败路径原样 */ }
```

3. fall-through 后走既有成功路径（`TurnCompleted` 等），不改 response_text / usage 处理。

### 边界钉死（测试）

- `result(success)` + `exit 1` + 空 stderr → Ok + 恰好一次 TurnCompleted + 零 TurnError。
- `result(success)` + `exit 1` + stderr 有噪声 → 同上（warn 日志含 sample）。
- 无 `result` + `exit 1` → 现有 `send_message_reports_exit_metadata_when_claude_fails_without_output` 不回归。
- `result` 且 `is_error: true` + `exit 1` → 仍 TurnError。
- prompt-too-long + 非零退出 → 仍走 `mark_retryable_prompt_too_long_error`（auto-compact 链路不受影响）。

测试 harness 复用 `tests_stream.rs` 的 `create_fake_claude_script`（shell script 打印 stream-json 行后 `exit 1`）。

## 2. E2 其他引擎适配器审计

已知同型：`gemini.rs:1482`（`!status.success()` → emit_error，无 result 检查）。审计清单：`kimi.rs:598`、`grok.rs:906`、`opencode.rs:715`、`pi.rs:1720`、`qoder.rs`、`dsh/`。逐一回答两个问题：①该引擎流内是否有等价 terminal/result 概念；②非零退出是否无条件否决它。结论记入 verification.md；仅对「有 terminal 且被退出码否决」的 identical inversion 修复（各自补测试），其余不改。

## 3. R1 分类器配额规则

`src/features/shared-session/provider-retry/classifySharedProviderRetryError.ts`：

1. `SharedProviderRetryKind` 增加 `"quota"`；`SharedProviderRetryReason` 增加 `"配额不足"`。
2. `classifyPermanent` 顶部新增（先于 config / pool 任何规则）：

```ts
if (/预扣费|余额不足|剩余额度不足|insufficient[_ -]?(?:balance|credit|quota)|quota(?:\s+is)?\s+exceeded|balance\s+insufficient/.test(text)) {
  return { disposition: "permanent", kind: "quota", reason: "配额不足" };
}
```

3. i18n：`providerRetryReasonQuota` 补 zh / ja / en（`src/i18n/locales/*/sharedSend.ts`），`SharedProviderRetryHint.tsx` `reasonKey` 加 `"quota"` 臂。
4. 正反对例测试：
   - 正：`Failed to authenticate. API Error: 403 预扣费额度失败, 用户剩余额度: ＄0.378004, 需要预扣费额度: ＄0.800000` → permanent / quota。
   - 反：`unexpected status 401 Unauthorized INVALID_API_KEY` → 仍 retryable pool；`failed to authenticate 403`（无配额关键词）→ 仍 retryable pool。

## 4. R2 identical-failure 熔断

`noteSharedProviderRetryTurn.ts` + `providerRetryControllerStore.ts`：

1. `SharedProviderRetrySeries` 增加 `failureSignature: string | null`、`sameSignatureCount: number`。
2. signature 计算（classify 模块导出 helper）：`sharedProviderRetryFailureSignature(kind, message)` = `${kind}:${normalizeMessage(message).slice(0, 120)}`。
3. `noteSharedProviderRetryTurnSettled` retryable 分支：构造 series 时比对 `current.series.failureSignature`——相同则 `sameSignatureCount + 1`，不同则重置为 1 并更新 signature。`sameSignatureCount >= 3` 时不进 `enterWait`，直接写 `exhausted` overlay（series=null，`lastMessage` 保留原文，kind 保留）。
4. 手动发送 / 切换 target / 成功等既有 clear series 路径不变，signature 随 series 一并清。
5. 测试（`noteSharedProviderRetryTurn.test.ts`）：
   - 同签名 × 3 → 第 3 次 settle 后 overlay=`exhausted`，countdown 不再启动（spy submitter 零调用）。
   - 同同异 → 不熔断，正常 enterWait。
   - 熔断后用户手动发送（`noteSharedProviderRetryUserSend`）→ 状态清理，后续失败可开新 series。

## 5. 测试与质量门

- `cargo test --manifest-path src-tauri/Cargo.toml claude`（tests_stream 新增 2~3 条 + 既有全绿）。
- `npx vitest run src/features/shared-session/provider-retry`（classify + note + hint 相关套件）。
- `npm run typecheck`。
- `openspec validate --all --strict --no-interactive`。
- Rust Format Gate：只对新改叶子文件 `rustfmt --edition 2021`，禁止全仓 fmt。

## 6. ADR 校准回写（archive 前置）

E1 变更了 Claude 引擎 turn terminal 的判定口径（result vs exit code precedence），命中基石文档更新触发器「terminal/ACK contract」。收口前须回写 `docs/research/mossx-multi-cli-provider-session-foundation-design.md`「最近校准」标注与「零、当前实现校准」表，校准行引用本 change id + `src-tauri/src/engine/claude.rs` 事实源。
