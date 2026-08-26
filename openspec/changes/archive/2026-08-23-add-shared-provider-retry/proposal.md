## Why

Shared 会话切供应商时，号池 403 / 超时 / 429 / 过载经常只炸一枪。供应商后台可能已经切号，但客户端把失败 attempt 落账后就停了。用户只能手动再发。Moss 驱动的是 CLI，做不到 Codex 那种 in-turn HTTP reconnect，只能按结果论再开一轮。

## 目标与边界

- Shared V2 失败落账后，同一家 CLI / Provider / Model 自动再发一轮续跑指令。
- 默认 3 次、指数退避 3s → 6s → 12s（上限 20s）。
- 设置按 `workspace + thread + CLI` 各记一份，只在内存，刷新回默认。
- 幕布一行小字提示；设置入口贴在协作 pill 右侧小弹窗。
- 不自动换供应商，不改 Shared send 九态，不重试 recovery / target-unavailable。

## 非目标

- Native / 非 Shared 会话。
- 把重试状态放进 Composer 状态条。
- 自定义幕布提示文案。
- 把每会话配置写入磁盘。
- 重发上一轮用户原文和图片。

## What Changes

- 新增 post-commit controller：分类失败 → 倒计时 → 走现有 `sendMessageToThread` 发续跑指令。
- Composer 协作槽增加「重试」pill + popover。
- 幕布时间线尾部增加一行提示。
- 自动续跑用户气泡带 `originKind: "shared-provider-retry"`。

## Spec deltas

- `shared-provider-retry`（new capability）：**ADDED** — Shared 供应商暂时失败后同一家再发一轮。
