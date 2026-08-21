# add-qoder-engine 代码审核 + 红线审计

> 审核方式说明：两轮独立 review subagent 因运行时资源问题未能完成，改为 orchestrator 在会话内完成两套审核（深读 + 证据 grep），结论与证据如下。文件：`review-code.md`（本文）。

## A. 代码审核（correctness）

### 深读覆盖

| 文件 | 审核面 | 结论 |
|---|---|---|
| `src-tauri/src/engine/qoder.rs`（~1450 行） | ACP client / spawn-per-turn / 事件映射 / 终态 / interrupt / 图片 / fs 沙箱 / Drop | **PASS**（2 个 P2） |
| `src-tauri/src/engine/qoder_history.rs` | list/load/delete 生命周期 / 去重 / 超时 | **PASS** |
| `src-tauri/src/engine/qoder_provider_profile.rs` | runtime key / home 解析 | **PASS**（含单测） |
| `commands.rs` Qoder 四臂 | 对照 Pi 臂逐行 | **PASS**（无残留 pi 字面值） |
| 前端 adapter/loader/parser + factory | 映射与分支顺序 | **PASS** |

### 关键路径核验记录

- **request 循环**（qoder.rs:789-863）：`&mut self` 单请求串行，无并发 id 竞争；异 id 响应 skip；`session/update` 双写 collected_updates + on_update；agent request 必答（permission/fs/未知 -32601）；每请求独立 deadline，prompt 30min。
- **身份**：session/new 返回真实 id 才发 SessionStarted；handshake 失败 → cleanup + TurnError + Err，**无伪造 id**；resume 响应无 id 时回落 resume_id（probe3 实测 shape）。
- **终态分域**：prompt JSON-RPC response = typed terminal；kill child 是独立 cleanup；terminal 后 update 丢弃（`prompt_result.is_some() || terminal_error.is_some()` → return）。
- **错误双通道**（R4）：`[Error]` 前缀 chunk 进 pending_error_chunks 不投影；TurnError message 优先取它，再 RPC error、stderr。
- **fs 沙箱**（401-442）：canonicalize root + 目标；write 新文件走 parent canonicalize + filename join；Path::starts_with 是组件级比较（`/tmp/ws2` 不会误判 `/tmp/ws`）；已存在 symlink 会被 canonicalize 解析后拒绝。
- **interrupt**：session/cancel notify → kill → interrupted_turns；QoderSession Drop 兜底 start_kill。
- **history**：messageId 去重 + 同 id 文本合并；available_commands/config_option/plan 跳过；cwd 过滤精确匹配。

### P2（不阻塞）

1. `qoder.rs` send_message 里 `handshake_failed` 分类变量计算后仅 `let _ =` 消费（错误信息走 raw_error 路径，行为正确，分类变量是死代码）——建议后续 change 清理或接上分类日志。
2. permission auto-approve 取第一个 `allow*` option——v1 headless 决策已记录；产品化 elicitation 桥接在「明确后置」。

### 代码审核结论：**APPROVE-WITH-COMMENTS**

## B. 红线审计（contract compliance）

| 项 | 结果 | 证据 |
|---|---|---|
| ACK 诚实（不拿 spawn/stdin/first-token 当 ACK；terminal 只信 typed response） | **PASS** | design §4 声明 `inputAck: "first-event"`；qoder.rs 终态仅取 prompt response |
| D 层白名单（TimelineRowRenderer / MessagesCore / useAppServerEvents / contracts / registry / factory） | **PASS** | sentinel 命中：1/4/18/1 + registry:22 + factory:107（在 codex fallback 之前） |
| Shared 排除（前后端双集合无 qoder；fail-closed） | **PASS** | sharedSessionEngines.ts 零命中；shared_sessions.rs supported fn 无 Qoder；v2/coordinator/projection 臂全部并入 Gemini\|Dsh fail-closed |
| Capability 诚实（supported 必有 spike 证据） | **PASS** | matrix.json qoder 行 15 key 与 spike §9 一致；unknown = reasoning/tool-output/mid-turn/tree 四个未实测项 |
| Vendor 文件纪律（红线 21，禁写 ~/.qoder） | **PASS** | qoder.rs 仅 fs/write agent-request（workspace 沙箱内）+ 测试临时目录；无 ~/.qoder 写删 |
| 身份（pending 只是 optimistic alias） | **PASS** | qoder-pending- 仅 composer optimistic row；promotion 合并 |
| 进程生命周期（所有路径杀 child） | **PASS** | 正常/错误/超时/interrupt/Drop 五路全覆盖 |
| Composer 映射（不落 claude） | **PASS** | engineToProvider case 'qoder'（ChatInputBoxAdapter:768）；AVAILABLE_PROVIDERS 有 qoder |
| i18n 10 语言 | **PASS** | en/es/fr/hi/ja/ko/pt-BR/ru/zh/zh-TW 全 OK |
| 预存问题诚实 | **PASS** | facade/docs/threads 失败集均经 HEAD worktree 复跑证实预存 |

### 红线审计结论：**零 must-fix**

## C. 待 review 环境补验（非代码问题）

- 成功 turn 黄金事件（本机模型 API 不可达）→ spike unknown 项升级
- 幕布五件节目视验收
- 双 config-dir 并行隔离 smoke
