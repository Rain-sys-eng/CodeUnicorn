# fix-dsh-custom-route-image-admission

## Why

用户在 DSH 会话里给 `grok-4.6` 附图，看到：

```text
attachment-error: Model "grok-4.6" does not support image input.
DSH resolved this model as text-only (custom llm-pi-ai routes fall back to defaultInput: [text]).
```

这不是模型不会看图，也不是 mossx 没把图发出去。DSH Host 只认 `resolveModelInfo().inputModalities`。自定义 `llm-pi-ai` 路由（中转 / 手写 provider，catalog 里没有这条模型）在条目和 catalog 都没声明模态时，回退 `defaultInput: [text]`，于是 Host 在 `session.prompt` 门口拒图。

上一轮只做了两件事，都不是产品方案：

1. 把 DSH 的拒图错误翻译成「请去 DSH settings 手写 `input` / `defaultInput`」
2. 有人直接改了本机 `~/.dsh/settings.yaml`

不能让每个用户去改自己的 DSH 配置文件。

## 目标与边界

### 目标

1. 用户在 mossx 里给 DSH 自定义路由附图时，软件 MUST 自动声明图片模态，使 Host 放行，无需打开 DSH Web UI 或编辑 `settings.yaml`。
2. 只写模态声明：`defaultInput` 或该模型条目的 `input`。MUST NOT 写 API key、baseURL、provider 列表或其它 profile 字段。
3. 官方 / catalog 已声明 text-only 的适配器（如 `llm-deepseek` 的 `deepseek-official`）MUST NOT 被写成 vision。
4. 本机已手写过 `[text, image]` 的用户 MUST 得到 no-op，不得反复改写。

### 边界

- 仍不在 mossx 设置页做 DSH provider / key 编辑器。
- 不把 DSH 配进 Shared。
- 不手改 `$DSH_HOME/settings.yaml` 文件；只走 Host RPC `settings.describe` / `settings.mutate`，让 DSH 自己校验并 live apply。
- 远程 / 只读 settings 写不进去时，才回退到可操作错误，而不是假装发出去了。

## 非目标

- 不探测上游网关到底支不支持 vision；声明后若网关拒图，由提供方在 turn 中失败。
- 不给所有模型预写 vision，只在「这一次发送带图」时补当前选中路由。
- 不调用 `credentials.*`，不 invent 一条不存在的 provider profile。

## What Changes

| 区域 | 变更 |
|------|------|
| `src-tauri/src/engine/dsh/image_admission.rs` | 纯函数：根据 `settings.describe` + `llm.providers` 计算最小 `settings.mutate` ops |
| `src-tauri/src/engine/dsh/mod.rs` | 附图 `session.prompt` 前 ensure 一次 |
| `src-tauri/src/engine/dsh/host.rs` | 拒图文案改为「软件会自动声明；只有写不进去才让用户开 DSH Settings」 |
| OpenSpec | 本 change；窄例外覆盖 `add-dsh-engine` 的「不调用 settings.*」 |

## Impact

- 用户路径：附图发送不再要求手改 yaml。
- DSH 文档仍归 DSH；mossx 只补 Host 准入声明。
- 只读 / 非 loopback host：保持 fail-closed，错误说明原因。
