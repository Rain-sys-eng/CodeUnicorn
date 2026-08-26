# fix-dsh-custom-route-image-admission design

## Context

DSH Host 在 `session.prompt` 看到 image part 时，调用 `ctx.llm.resolveModelInfo(provider, model)`。`inputModalities` 不含 `image`（或被解析成只有 `text`）→ `attachment-error` / `MODEL_DOES_NOT_SUPPORT_IMAGES`。

`llm-pi-ai` 解析顺序：

```text
model entry.input  →  installed catalog entry.input  →  route.defaultInput（默认 [text]）
```

自定义路由（`api` + `baseURL` + 手写 `models`，catalog 不认识这条 provider/model）走到第三层，于是 grok-4.6 这种明明能看图的中转模型被 Host 判成 text-only。

mossx 已经能把图编成 `PromptContentPart.image`。缺的是 Host 准入声明。

`add-dsh-engine` 把「不调用 `settings.*`」写成非目标，是为了不在 mossx 里做完整 DSH 配置面。本 change 开一条窄例外：只写图片模态。

## Goals / Non-Goals

Goals：附图发送时，软件补齐 Host 需要的 `input: [text, image]` / `defaultInput: [text, image]`。

Non-Goals：provider 编辑器、探测网关、Shared、直接改 yaml 文件。

## Decisions

### 1. 触发点

只在 `send_user_turn` 已经 load 出非空 `prompt_images` 之后、`session.prompt` 之前。纯文本发送不碰 settings。

选中模型优先用本次 `session.selectModel` 的 `{provider, model}`；没有显式选择则读 `host.describe` 的当前 `{provider, model}`。两者都没有 → 不写 settings，让后续 prompt 走 DSH 自己的错误。

### 2. 写什么，不写什么

1. `settings.describe` + `llm.providers`。
2. 找到该 provider 的 `settingsNs` + `settingsPath`。
3. 只处理 `settingsNs == "llm-pi-ai"`。其它 namespace（`llm-deepseek` 等）不写：那些适配器自己声明模态，乱写会把官方 text-only 模型改成 vision。
4. `writable == false` → 不写，返回可操作错误。
5. 规划最小 ops，再 `settings.mutate`。

路径策略：

| 现状 | ops |
|------|-----|
| 路由不存在（providers 里没有这条，或 user/value 里没有 profile） | 不 invent profile。报错：先在 DSH Settings 配好这条路由 |
| 该模型在 `models[]` 里，且 `input` 已含 `image` | no-op |
| 该模型在 `models[]` 里，`input` 缺 `image` 或只有 `text` | `set providers.<route>.models.<i>.input = [text, image]` |
| 该模型不在 `models[]`（走 catalog 或只靠 defaultInput） | `set providers.<route>.defaultInput = [text, image]` |
| `defaultInput` 已含 `image` 且没有更窄的 model `input` | no-op |

`settings.mutate` 的 path 不能走进 array index（`applyPathOp` 只认 plain object）。改 `models[i].input` 时，必须 set 整份 `models` 数组，只改命中条目的 `input`，其它字段原样保留。

### 3. 冲突与生效

带 `expectedRevision`。`settings-conflict` 再 describe 一次重试，最多 1 次。mutate 成功后 DSH live apply，同一次 `session.prompt` 就能看到新的 `inputModalities`。

### 4. 失败语义

| 情况 | 行为 |
|------|------|
| 已声明 image | 直接 prompt |
| mutate 成功 | 继续 prompt |
| 只读 / 非 llm-pi-ai / 没有这条路由 | fail-closed，错误说明原因并给「打开 DSH Settings」 |
| mutate 失败 | fail-closed，不要先 prompt 再吃 attachment-error |

### 5. 错误文案

`MODEL_DOES_NOT_SUPPORT_IMAGES` 不再教用户手改 yaml。改成：软件会在附图发送时自动声明；若仍失败，多半是 host 只读、路由不在 `llm-pi-ai`、或网关真的拒图。

## Risks

- 把不会看图的自定义模型声明成 vision：用户既然附图，就是要看图；网关拒图会在 turn 中失败，比 Host 门口误杀好。
- 写整份 `models` 数组：只改 `input`，保留 id/name/其它字段。
- 远程 host：`settings.*` 是 loopback-only。非本机 origin 走 fail-closed。

## Verification

- 纯函数单测覆盖：no-op / 补 defaultInput / 补 model input / 非 pi-ai 拒绝 / 无路由拒绝 / 只读拒绝。
- 既有 host envelope 单测更新文案断言。
