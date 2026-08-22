## Why

Composer「增强提示词」还停在 Claude/Codex 原生 select、上下堆叠审阅、以及会把短草稿铺成 Goal/背景/验收套话的指令。结果还容易整段重复。用户已选定方案 A：并排对照 + Composer ModelSelect + 增强强度 + 只显示供应商设置已启用 CLI。

## 目标与边界

### 目标

- 弹窗模型选择复用 Composer `ModelSelect`（引擎子菜单 → 模型），文案与主选择器一致。
- 引擎列表只含供应商设置「已启用」CLI（`disabledCliEngines` 黑名单）；未启用不显示。
- 可执行引擎：claude / codex / grok / kimi / opencode / pi / dsh。Gemini 仍禁用。
- 增强强度三档：轻润色 / 结构化 / 可执行。改写策略，不是模型 reasoning effort。
- 左右并排审阅，增强侧标出新增片段；交互细节（hover、loading、disabled、Esc/Enter、空引擎）完整。
- 指令禁止套话模板与复述；结果规范化必须去掉整段重复后再展示。

### 边界

- 不改 Composer 发送链路、不改供应商设置启停语义。
- 不引入双候选工作室（方案 B）。
- Claude retryable 失败仍可 fallback Codex；非 Claude 失败不静默改走 Claude。

## 非目标

- 不做流式 diff。
- 不把质检 chip（原意锁定等）做成可点开关。
- 不在弹窗里管理 CLI 启停。

## What Changes

- `usePromptEnhancer`：引擎白名单、强度、可见性过滤、指令、去重、cache key。
- `PromptEnhancerDialog`：方案 A 布局 + ModelSelect + 强度 + 并排对照。
- i18n：zh/en 手写，其余 locale 走现有生成脚本或镜像英文 key。
- OpenSpec `composer-prompt-enhancer` delta。

## Capabilities

### Modified Capabilities

- `composer-prompt-enhancer`：引擎可见性、ModelSelect、强度、并排审阅、去重。
