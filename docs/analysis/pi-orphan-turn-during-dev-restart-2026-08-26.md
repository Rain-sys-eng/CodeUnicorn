# 分析：dev 重启窗口发送消息导致 turn 永久「响应中」（孤儿 turn）

- 日期：2026-08-26
- 状态：已核实（2026-08-26 代码核实确认结构性缺口）→ 已开 OpenSpec 提案 [`fix-orphan-turn-during-backend-unavailability`](../openspec/changes/fix-orphan-turn-during-backend-unavailability/proposal.md)，待实施
- 影响引擎：PI（实测；其他引擎可能同病，未验证）
- 现象来源：用户截图 —— 会话发出「更新一下 0.9.3 还是用用户的视角更新.」+ CHANGELOG.md 文件引用（REFERENCES），UI 永久停在「0:46 响应中...」，无任何 delta / error。

## 一、现场时间线（决定性证据）

本地时间（Asia/Shanghai）：

| 时间 | 事件 | 证据 |
| --- | --- | --- |
| 17:34 | 上一个 app 内 PI 会话正常完成（「耗时6s」那条，另一个并行会话做完测试并提交） | `~/.pi/agent/sessions/--Users-chenxiangning-code-AI-github-codemoss--/2026-08-26T07-56-24-766Z_*.jsonl` 尾部 timestamp `09:34:52Z`（=17:34 本地） |
| 17:38 | 有终端在跑 `tauri build --target aarch64-apple-darwin`（打包构建） | `ps aux`：PID 90124，起始 17:38 |
| 17:39 | `tauri dev` 重新拉起（dev server esbuild 17:39 起） | `ps aux`：tauri dev PID 92643 / vite PID 92796，起始 17:39 |
| **17:41:18** | **用户发出「更新一下 0.9.3…」+ CHANGELOG.md 引用 → 永久「响应中」** | 截图时间戳 `08-26 17:41:18 耗时6s` 为上一条正常消息；下一条即卡死消息 |
| 17:41 → | rustc 全速编译 `cc_gui_lib`（99% CPU，持续数分钟） | `ps aux`：rustc PID 11085，99.6% CPU |

## 二、三条硬证据

1. **pi session 目录零写入**：`~/.pi/agent/sessions/--Users-chenxiangning-code-AI-github-codemoss--/` 在 17:34 之后没有任何 jsonl 更新。卡住的消息（含「更新一下 0.9.3」文本）在全部 session 文件中 grep 不到（仅出现在今天诊断用的两个外部会话里）。⇒ 消息**从未到达 pi 进程**。
2. **当时没有任何 pi 进程存活**：`ps aux` 查不到 app 拉起的 pi agent 进程。PI resident 会话进程已随 dev 重启消失。
3. **17:35 前链路正常**：上一条消息 6s 完成，排除 GLM 慢 / 附件格式 / 用户操作因素。

## 三、根因

`tauri dev` 热重启窗口（旧 WebView 未刷新 + 后端 Rust/引擎进程已退出）内发送消息：

- 前端仍是旧 WebView 实例，composer 可输入、可发送（乐观 UI 正常）。
- 后端引擎（PI resident 进程）已死或在重建，turn 请求无人认领。
- 没有任何 turn/error 事件回来 ⇒ 前端 turn 状态机永远停在「响应中」。

即：**dev 重启场景下的孤儿 turn**。0.9.3 已有的 RPC circuit breaker（冷却后自恢复）覆盖的是「运行中进程故障」，不覆盖「发送瞬间引擎进程不存在且永远不会有回执」这个窗口。

## 四、修复方向（待做）

1. **发送前健康预检（send gate）**：PI 发送路径在 dispatch 前检查 resident 进程 / RPC 通道是否存活；不可用则快速失败并提示「引擎重启中，请重试」，不进入 turn。
2. **孤儿 turn 看门狗**：turn 进入「响应中」后若在 N 秒内连 `turn/started` / heartbeat 都没收到，判定为孤儿，落 turn/error 并给出可重试错误（参考已有「mid-turn silence watchdog settles the turn when a Claude stream goes quiet」的做法，但这里连第一个事件都没有）。
3. （可选）Tauri dev 热重启时主动向前端广播 backend-restarting，前端禁用发送入口。

## 五、关联事实

- 归档 change `fix-file-document-loading-error-stuck-state`（2026-07-26）是**文件预览面板**卡 loading，与本问题不同链路，勿混。
- 本问题与 0.9.3 修复列表中的「Turns hung forever on relay stalls」（Claude relay 卡流看门狗）症状相似、根因不同：那是流中断，这是从未起流。
