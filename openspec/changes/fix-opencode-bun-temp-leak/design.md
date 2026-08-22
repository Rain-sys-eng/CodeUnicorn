## Context

ccgui 当前通过 `OpenCodeSession::build_command()` 启动 one-shot
`opencode run --format json`。Windows 现场证明该 external runtime 可能因为 Bun compiled
executable native extraction，在系统 `%TEMP%` 创建大量随机 `.dll` / `.node` 文件。

现有调用面不只包含发送 turn：engine status 会执行 `--version`、`--help` 与 `models`，
CLI lifecycle/doctor 也会探测版本。因此 containment 不能只补在一个 `send_message` callsite；
必须复用一个 OpenCode-specific child environment policy，覆盖 desktop 与 `cc_gui_daemon`
创建的 OpenCode management / session / provider commands。其他 engines 继续走现有 generic
CLI launcher，不能被此问题的环境变量策略污染。

`opencode --version` 只能证明 OpenCode CLI version，不能可靠证明其 embedded Bun version。
因此实现不得根据 OpenCode semver 伪造“Bun 已修复”的结论。ccgui 已有 `opencode-ai@latest`
npm-global upgrade path；本 change 的运行时防护必须对 old/custom runtime 也有效。

## Goals / Non-Goals

**Goals:**

- 在 Windows 将 ccgui 管辖的 OpenCode child process 的 `BUN_TMPDIR` 定向到
  `~/.ccgui/runtime/opencode-bun-tmp/run-<uuid>`，而不是系统 `%TEMP%`。
- 每个 child 持有独立 run directory lease；process 结束后只删除该 lease 对应的目录。
- 通过 owner marker、file lock、direct-child path validation 防止 stale cleanup 误删其他目录。
- 对单 child 和所有 active/stale owned directories 执行容量预算；超过预算时终止触发增长的
  OpenCode turn，避免异常 runtime 在单次运行中重新写满磁盘。
- 对所有 ccgui-created OpenCode child（run、status、models、doctor、installer、management
  command、session command 及 `cc_gui_daemon`）应用同一 policy；doctor 返回不含完整路径的
  containment / runtime-provenance diagnostics。
- macOS/Linux 保持继承的 `TMPDIR` / `BUN_TMPDIR`，零行为改动。

**Non-Goals:**

- 不修改 Bun、`opencode-ai` package 或自定义 binary 本身；只建议用户通过既有 upgrade path
  升级到包含 Bun 1.4.0+ 修复的上游 runtime。
- 不做全局 `%TEMP%` / `$TMPDIR` 清理，不清理 Tauri updater 或第三方 artifact。
- 不在 macOS/Linux 提前写入 `BUN_TMPDIR`，也不以“未复现”代替兼容性结论。
- 不迁移到 persistent `opencode serve`，不改 OpenCode one-shot protocol 或 frontend IPC。

## Decisions

### 1. Windows 使用 per-child private directory，而非共享应用目录

`opencode_native_artifact` internal module 为每个 child 创建
`~/.ccgui/runtime/opencode-bun-tmp/run-<uuid>`，并仅在 `cfg(windows)` 下向该 child 注入
`BUN_TMPDIR`。父进程和系统环境不变。

每次运行使用独立目录有三个效果：

- cleanup 可以精确绑定到 child lifecycle，不会删除并发 turn 正在使用的 native library；
- crash residue 可以在下一次启动 OpenCode 时用 lock 识别并安全回收；
- 容量可以按 run 和 root 分别统计，避免一个漏写 runtime 无界消耗系统盘。

选择 `app_paths::app_home_dir()` 而非 Tauri `AppHandle` path，是因为 engine/status/doctor
均可在没有 UI handle 的后端路径执行，并且 `~/.ccgui` 已是本仓库的 application-owned root。

### 2. 以 lease + marker + lock 证明 ownership

每个 run directory 内创建不可变 owner marker 和 `.ccgui-owner.lock`。cleanup 只接受：

1. direct child of the dedicated root；
2. 名称符合 `run-<uuid>`；
3. 不是 symlink；
4. marker 内容匹配本 feature 的固定 ownership token。

stale cleanup 尝试取得其 lock；失败表示其他 ccgui instance 仍拥有该目录，必须跳过。正常
child lifecycle 持有 lease，退出、超时或 interrupt 后才释放并删除自己的目录。所有 cleanup
failure 只记录 warning / diagnostics，绝不扩大删除范围。

复用现有 `File::try_lock` / `unlock` 模式，不新增 dependency 或全局锁服务。

### 3. 预算熔断优先于“等待下次清理”

仅靠 child exit cleanup 无法防止一个长 turn 在退出前再次写满 C 盘。因此 Windows policy 增加：

- 单 run hard limit：256 MiB；
- owned root hard limit：512 MiB；
- 至多每秒读取一次 metadata（不读取文件内容）。

达到任一 limit 时，当前 OpenCode turn 走已有 child termination path 并返回可诊断的
`BUN_TMPDIR` storage-limit error。新 child 在 root 已超过 limit 且无法回收 stale lease 时
拒绝启动，而不是回退到系统 `%TEMP%`。

这两个数字远高于正常 native library extraction 的预期量，但将已观测的 20 GB 事故收敛到
受控上限。它们是安全护栏，不是替代上游 Bun upgrade。

### 4. 统一覆盖 OpenCode command surfaces

新增 `ContainedOpenCodeCommand`，将 `tokio::process::Command` 与 lease 绑定，使 lease 覆盖
`.output()` 或 `.spawn()` 的完整生命周期。以下路径必须调用它：

- `OpenCodeSession::build_command()` 的 `opencode run`；
- OpenCode engine status 的 `--version`、`--help`、`models` probes；
- OpenCode doctor 的 version/help probes；
- OpenCode installer 的 installed/version probe。
- desktop 的 OpenCode command / agent / session / stats / export / import / MCP / provider
  commands；
- `cc_gui_daemon` 的 OpenCode session / management commands。

generic `check_cli_binary()` 保持其他 engines 不变；为 OpenCode 增加 explicit wrapper，而不是
通过 binary name 猜测后在 generic path 注入环境。

### 5. diagnostics 区分 containment 与 runtime provenance

`opencode_doctor` 增加 `opencodeNativeArtifactContainment`：

- Windows：policy enabled、owned artifact count/bytes、limits、last cleanup scope、runtime
  provenance=`unverified` 与升级建议；
- macOS/Linux：policy=`inherit-environment`、evidence=`unverified`。

不输出实际 home/path、随机文件名、prompt 或 session data。由于 embedded Bun 不可通过
OpenCode version 可靠判定，doctor 不将任何 custom/runtime 伪标记为“已安全”。

### 6. macOS 的显式不变式

所有 write/cleanup/injection code 以 `cfg(windows)` 包住。non-Windows lease 是 no-op，
不会创建 `~/.ccgui/runtime/opencode-bun-tmp`，不会覆盖从用户 shell 继承的 `BUN_TMPDIR` /
`TMPDIR`，也不会扫描或删除 `$TMPDIR`。

## Risks / Trade-offs

- [旧 runtime 在单个 turn 内超过预算而被终止] → 返回明确 storage-limit error，保留既有
  interrupt/settlement semantics，并建议升级 `opencode-ai`。这比允许继续写满系统盘更安全。
- [wrapper child 退出与实际 runtime process 存在短暂时序差] → immediate cleanup 失败时只保留
  owned residue；下一次 OpenCode launch 用 lease lock 重试，不删除未知或 locked directory。
- [metadata scan 在泄漏中变慢] → 每秒最多一次、只读取 metadata；budget 在早期约 256 MiB
  触发，避免扫描上万 artifact 的稳态。
- [macOS upstream 仍可能有同类缺陷] → 本 change 不改变 macOS 行为；手工验证采样作为
  evidence gate，后续证据成立时再单独决策跨平台 containment。
- [user configured global `BUN_TMPDIR`] → Windows 仅对 ccgui-created OpenCode child 覆写；
  父进程与其他应用不受影响。macOS/Linux 完全保持继承值。

## Migration Plan

1. 添加 internal containment module 和 unit tests，先验证 ownership / lock / cleanup /
   budget helpers。
2. 接入 OpenCode run 与 status/doctor/installer probes；保持所有 non-OpenCode callsite 不变。
3. 在 Windows 使用 known vulnerable OpenCode runtime 做重复 turn regression，确认 artifact 不再
   出现在 `%TEMP%`，且 private root 不超过 budget。
4. 在 macOS 手工验证 `BUN_TMPDIR` / `TMPDIR` 继承、run/stream/interrupt/attachment，并记录
   evidence state；不以一次未复现宣称已排除。
5. 如果 containment 异常：删除/回退该 child environment policy 即可恢复旧行为；私有 root
   可保留给下一次安全 stale cleanup，禁止手动批量删除系统 Temp。

## Open Questions

- 上游 `opencode-ai` 的哪个 release 首次携带 Bun 1.4.0+ 不能由当前 CLI version 独立证明；
  release provenance 应由 upstream 发布材料维护，ccgui doctor 只给 upgrade recommendation。
- macOS 是否会产生同类 `.dylib` / `.node` residue 仍是未验证事实；在获得实机样本前不得
  扩大本 change 的平台行为。
