# Change: cache-first-engine-model-catalog

## Why

首次打开模型下拉（每个会话第一次）对 PI 引擎要同步等待 2~20s:本地 Tauri 命令
`get_engine_models` 的 Pi 分支无视缓存与 `force_refresh`，每次都全量跑
`detect_pi_status`——为拿一张基本静态的模型表冷启动完整 `pi --mode rpc --no-session`
进程（Node 冷启动 + RPC `get_state` 握手 + `get_available_models`，各 10s budget）,
失败还要再 spawn 第二次 `pi --list-models`,version 探测并行第三个进程。Kimi/Grok
分支同构（每次 fresh detect)。而 Claude/Codex 分支早已是 cache-first,daemon remote
路径对 Pi 也是 cache-first——本地命令是唯一异类。

启动时 `useEngineController` 挂载即 `detectEngines()` 全量填充 manager 缓存，预热链
路已存在；picker 首次打开完全可以命中缓存秒出。

## What Changes

- `get_engine_models` 的 Pi / Kimi / Grok 分支改为 cache-first:
  - 非 `force_refresh` 且缓存非空 → 直接返回缓存,**不发起任何 CLI 探测**
  - `force_refresh` 或缓存为空 → 走现有 fresh detect;fresh 非空则回写 manager 缓存
  - fresh 返回空 → 回退 last-good 缓存(保留三分支现有兜底语义,不回归)
- 抽出可单测 helper `resolve_engine_models_cache_first`(refresh 闭包注入),Pi/Kimi/Grok
  三个 arm 复用;`EngineManager` 新增 `cache_engine_status` 回写方法
- Claude / Codex / OpenCode / Qoder / Dsh / Gemini 分支**不动**;daemon remote 路径不动
- 手动刷新按钮(`forceRefresh: true`)与 FE fallback-only auto-recover 契约不变:
  force 路径仍绕过缓存走完整探测链

## Impact

| 维度 | 说明 |
| ---- | ---- |
| Backend | `engine/commands.rs`(Pi/Kimi/Grok arm + helper)、`engine/manager.rs`(缓存回写方法) |
| Frontend | 无改动(语义由 backend 吸收) |
| 热路径 | 切会话零影响(本就不发 catalog IPC);picker 首开从「同步 2~20s」变「缓存直出」 |
| 新鲜度 | 模型表新鲜度窗口 = 启动 detect + 手动刷新 + models.json 变更走的 `reload-config`(force);可接受 |
| Out of scope | daemon `get_engine_models` 不消费 `forceRefresh`(既有缺口,另开 change);磁盘 TTL 缓存;catalog 探测免 spawn(读 models.json) |

## Acceptance

1. 启动完成后首次打开 PI 模型下拉 → 立即展示缓存 catalog,无 `pi` 进程 spawn。
2. 点刷新按钮 → 走完整 RPC/list-models 探测链,成功后菜单与缓存同步更新。
3. 探测失败(空结果)→ 展示 last-good 缓存,不出现空列表闪烁。
4. 缓存为空(如启动 detect 未完成)时首开 → 走 fresh 探测,行为同现状。
5. 切会话路径零 catalog IPC(既有契约,不回归)。
