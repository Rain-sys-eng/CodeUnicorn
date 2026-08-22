## Why

Qoder ACP 已验证 model selection、typed cancel、usage、session fork 与本地历史 fallback 等能力，但 Native runtime 没有完整兑现：配置错误会静默降级、cancel 会被 process kill 覆盖、custom `home_dir` 与探测面分叉，部分已声明能力没有产品路径。

现在修复可在 Qoder 进入 Shared 前收紧 Native contract，并使 capability evidence、代码与 ADR 保持一致。

## 目标与边界

- 收口 Qoder Native runtime 的配置、terminal、usage、fork 与 history fallback 契约。
- 让 capability matrix 的 `supported` 表示 mossx 已暴露且可验证的产品能力，而不只是 vendor CLI 探测结果。
- 仅写入本 change 自己的 artifacts 与明确归属 Qoder 的代码/测试；不修改 Shared runtime 或接管 `enable-qoder-shared-target` 的未提交改动。

## 非目标

- 不改变 Qoder 的 spawn-per-turn execution model。
- 不读取、写入或删除 vendor history 以外的 Qoder 配置/凭据；delete 仍经 ACP。
- 不实现 Shared target wiring、mid-turn direct prompt queue UI，或新的 provider CRUD。
- 不处理仓库既有 Rust warnings。

## What Changes

- 传播 `session/set_model` 与 `session/set_config_option` 的失败，禁止静默使用旧配置发送 prompt。
- 将 `session/cancel` 改为等待 Qoder typed terminal；只在有界超时后 kill child，并统一投影 cancelled terminal。
- 让 status、model catalog 与 doctor 使用同一 resolved Qoder `home_dir`，避免自定义 config root 分叉。
- 从 prompt result 解析 usage 并发出统一 `UsageUpdate`。
- 将已实测的 ACP `session/fork` 接入既有 Native send contract，并保留新 session identity。
- 本地 Qoder history 目录存在但读取失败/不可用时回退 ACP，而不是错误返回空列表。
- 校准 Qoder OpenSpec、capability matrix 与基石 ADR；明确 Shared 仍由独立 change 收口。

## 方案取舍

1. **推荐：兑现所有已实测的 Native 能力。** 保持 capability matrix 与产品行为同义，新增 focused tests；改动局限在 Qoder runtime、既有 fork route 与校准文档。
2. **仅修运行时 P0。** 改动更小，但 fork/usage 仍是“CLI 已知、产品不可用”的虚假 supported，不采用。
3. **下调 matrix 声明。** 可以最快消除文档不一致，但丢弃已验证能力，且不满足本次补齐目标，不采用。

## Capabilities

### New Capabilities

- `qoder-native-runtime-contract`: Qoder ACP Native session 的配置、terminal、usage、fork、config-root 与 history fallback 行为。

### Modified Capabilities

- `engine-capability-matrix`: Qoder 的 `supported` capability 必须同时具有 vendor evidence 与 mossx product route/test evidence。

## Impact

- Rust：`engine/qoder.rs`、`engine/status.rs`、`engine/commands.rs`、`engine/manager.rs`、`engine/qoder_history.rs`、Qoder doctor/相关 tests。
- Docs：本 change artifacts 与基石 ADR 的 Qoder calibration row。
- 无新依赖、无数据迁移、无 Shared schema 修改。
