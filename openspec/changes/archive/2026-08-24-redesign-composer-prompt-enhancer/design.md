## 背景

现实现：

- `PROMPT_ENHANCER_ENGINE_OPTIONS = ['claude','codex']`
- 原生 `<select>`，catalog 脏值会直接显示
- 原文/结果上下堆叠
- 指令鼓励 Goal/Context/约束；Claude 额外限 6 行
- 重复只靠 `getNormalizedAssistantMessageText` 折叠整段拷贝，套话重复仍会进结果

定稿见 `docs/designs/prompt-enhancer-redesign/index.html`。

## 方案

### 引擎可见性

可见引擎 = 可执行引擎 ∩ 未出现在 `useCliEngineVisibility()`（即 `AppSettings.disabledCliEngines`）。

打开弹窗时：

1. 当前 Composer provider 若可见，用作默认引擎
2. 否则回落到可见列表第一个
3. 可见列表为空：显示去供应商设置启动，禁用开始增强

切换引擎只影响这一次增强 run，不改 Composer 当前会话引擎。

### 模型选择

弹窗复用 `ModelSelect`，传入过滤后的 `modelGroups` + `onProviderModelChange`。交互与 Composer 主选择器相同：引擎子菜单、绿点、hover 出模型。不另做一套 select。

### 增强强度

`light | struct | exec`，写入 instruction，并进入 cache key。

| 档 | 行为 |
|---|---|
| light | 只整理措辞；短草稿不扩写 |
| struct | 必要时才分节；禁止 Goal/背景/验收硬套 |
| exec | 补动作与验收；不编新事实 |

质检规则始终生效，不是 UI 开关：保原意、不编事实、去套话、语言跟随草稿。

### 去重

两层：

1. **指令**：禁止复述草稿、禁止同一句换行再写一遍、禁止套话标题。
2. **结果规范化**：先走现有 assistant text normalize，再做 enhancer 专用 collapse：连续重复段落、首尾相同块、紧凑文本整段 ×2/×3。空结果仍按 empty error。

### 审阅 UI

左右栏。左：可编辑原文（改原文会清掉未采用结果）。右：增强结果；成功后对新增 token 着色。Loading 显示引擎图标 + 模型名。Enter 采用，Esc 关闭。
