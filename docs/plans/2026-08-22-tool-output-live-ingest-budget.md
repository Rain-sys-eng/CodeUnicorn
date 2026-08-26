# 终端工具输出 live ingest 预算

> **Status:** P0 已落地（2026-08-23）。回退：`localStorage.setItem("ccgui.perf.toolOutputBudget", "off")`。
>
> **For Claude:** 事故里出现的具体目录名只是样本，禁止写进 ignore / junk 名单。

**Goal:** 任意 CLI 把超大工具输出（递归 listing、全仓 `rg`、未知缓存树）灌进对话时，客户端主线程不顿挫；短输出完整保留。Native 与 Shared 共用同一条幕布 ingest，不按引擎分叉。

**Architecture:** 卡的主因是 `liveItemDeltaChannel` 对 `toolOutput` 无界拼接，48ms 把全文灌进 `BashToolBlock` 做 `split`。画布层已经只画最后 200 行，再把 UI 改成 100 行几乎无效。预算必须下沉到 ingest，且 **与路径名无关**：live 通道与 `appendToolOutput` reducer 复用已有 `boundToolOutput`（256KiB 头+尾）。不按事故样本扩 junk 叶名。

**Tech Stack:** TypeScript live channel + reducer；Vitest。不改 Rust junk 名单。

---

## 0. 问题边界

内测样本：新开 Codex 会话扫源码，终端命令吐出源码命中，随后把一棵巨大的非源码树（浏览器 profile / 运行时缓存 / 任意 junk）整目录 listing 灌进卡片。Shared / Native 同病。**样本目录名不得成为产品规则。**

| 层 | 现状 | 本方案 |
|---|---|---|
| 画布 `BashToolBlock` | 已 `slice(-200)`；分组块已 `-100` | 不改行数帽 |
| live `toolOutput` 通道 | 全文无界拼接，48ms 发布 | **P0 必管，与路径无关** |
| `appendToolOutput` reducer | `mergeStreamingText` 无预算；settle drain 走这里 | **P0 必管** |
| assembler `boundToolOutput` | 已有 256KiB，flag `ccgui.perf.toolOutputBudget` | 复用，不新造一套 |
| CCGUI 文件树 junk 叶名 | 已有 `node_modules` / `temp` / `tmp` 等已知类 | **不按事故加名** |
| CLI 终端 `find` / `rg --no-ignore` | ignore 文件挡不住 | 不装神；只保证 GUI 不被 log 打死 |

顿挫在 WebView 主线程。磁盘枚举本身在 SSD 上通常不是「整机卡」的主因。

---

## 1. 非目标

- 不把任何一次事故里的目录名写进 junk / `.gitignore` / `.codexignore` / developer instruction。下一棵未知缓存树照样会来。
- 不恢复 0.8.9 开会话 upsert `.codexignore`。Codex 不保证消费；shell 仍绕过。
- 不把 UI `MAX_OUTPUT_LINES` 从 200 改成 100。短的有用 `rg` 经常超过 100 行；改帽不减 `split` 成本。
- 不改 reasoning lane 预算。
- 不改真实 PTY 终端（已有 200,000 字符尾部窗口）。
- 不承诺拦住 CLI 去扫盘。P0 只保证 **扫的时候客户端不炸**。
- 不按引擎分叉。落点是幕布 `toolOutput` ingest（`liveItemDeltaChannel` + `appendToolOutput`），Native / Shared、Claude / Codex / Grok / 其它引擎只要走这条热路径就自动带上。禁止写 `if (engine === "codex")`。

---

## 2. 设计（P0 only）

两处必须同一套函数，禁止第三套「按行数、按目录名」的队列：

1. `appendLiveItemDelta`：仅 `lane === "toolOutput"` 时  
   `text = boundToolOutput(prev + delta, "commandExecution")`  
   `reasoningContent` / `reasoningSummary` 保持现状。
2. `useThreadsReducer` `appendToolOutput`：写入前  
   `output = boundToolOutput(mergeStreamingText(...), existing.toolType ?? "commandExecution")`。

`boundToolOutput` 已保证：头 64KiB 稳定、超出部分进 `…[omitted N chars]…`、flag=off 原样。live 首段 `shellTextLength` 落在头里，drain 的 `text.slice(shellTextLength)` 仍前缀稳定，不必改 settle 合同。

**发布快照：** `publishThreadEntries` 对 `toolOutput` key 只发布「最后 200 行」或「最后 64KiB」的较小者。权威 `entry.text` 仍是 256KiB bounded 全文。流式期 `split` 成本与树有多大无关。settle 后切回 durable。

回退：`ccgui.perf.toolOutputBudget=off` 两处同时失效。

这套对任何超大 stdout 生效：未知缓存目录、`node_modules` 漏网、全仓 `find`、二进制 `rg --no-ignore`。

---

## 3. 落地任务

### Wave 0：基线（改代码前）

```bash
pnpm vitest run src/features/threads/utils/liveItemDeltaChannel.test.ts \
  src/features/threads/utils/boundToolOutput.test.ts \
  src/features/messages/components/toolBlocks/BashToolBlock.test.tsx
```

记录失败集。事实源是 `boundToolOutput.ts`，不扩 junk 名单。

### Task P0-a：live 通道 toolOutput 套 `boundToolOutput`

**Files:**
- Modify: `src/features/threads/utils/liveItemDeltaChannel.ts`
- Test: `src/features/threads/utils/liveItemDeltaChannel.test.ts`

**合同：**
- 合成超大 `toolOutput`（例如 400KiB 随机行，不绑定任何真实路径名）后，`peekLiveItemDelta` 长度 ≤ 256KiB，含 omit marker，前缀仍是原文头。
- 同一线程 `reasoningContent` 仍无界。
- `drainLiveItemDeltaTail` 后，`shell + drained` 再 `boundToolOutput` 与 peek 一致。
- flag off 恢复无界。

### Task P0-b：published 快照只发显示尾

**Files:** 同上 + test。

`takeLastLines(text, 200)` 纯函数。`toolOutput` published ≤ 200 行；reasoning 仍发全文。

### Task P0-c：reducer `appendToolOutput` 写入前 bound

**Files:**
- Modify: `src/features/threads/hooks/useThreadsReducer.ts`（`case "appendToolOutput"`）
- Test: 300KiB delta → 输出含 omit 且 ≤ 256KiB

### Task P0-d：与路径无关的压测

Vitest 合成 N 行路径-like listing（随机深度，不写死样本目录名），4KiB chunk 灌入 `appendLiveItemDelta`。断言尺寸合同，不咬 wall-clock。

---

## 4. 验收

1. 合成超大 listing 流式灌入后，live peek ≤ 256KiB，published ≤ 200 行。
2. 卡片可点、可滚。
3. 回合结束后 durable 为头+omit+尾，不是空、不是只剩 100 行。
4. `toolOutputBudget=off` 可回退。
5. 短输出（百行级 `rg`）完全不丢、无 omit marker。

**不验收：** CLI 是否还递归某棵运行时树。**不验收：** 文件树是否按某个叶名 prune。

---

## 5. 回滚

`localStorage.setItem("ccgui.perf.toolOutputBudget", "off")` 后刷新。P0 三处同一函数+同一 flag，可整波 revert。

---

## 6. 顺序

P0-a → P0-b → P0-c → P0-d。一个 PR。不要和 Qoder/AppShell 混提交。
