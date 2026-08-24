# fix-qoder-pat-env-precedence tasks

- [x] 1. OpenSpec proposal / design / spec delta，`openspec validate` 通过
- [x] 2. `qoder_auth.rs`：抽 `select_spawn_pat` 纯函数，`resolve_qoder_pat_for_spawn_for_distribution` 改为 stored 优先（删 env early-return）
- [x] 3. `QoderAuthStatus` 增加 `env_present`（camelCase `envPresent`），`qoder_auth_status_from_path_for_distribution` 填充
- [x] 4. Rust 单测：优先级四组合（pinning env 不再赢 / 无 stored 不注入）；`env_remove` 隔离回归；status `env_present` 三态（`cargo test --lib qoder` 84/84 绿）
- [x] 5. 前端 `qoderAuth.ts` 类型加 `envPresent`；`QoderAuthSection` 在 `configured && envPresent` 显示 envIgnoredStoredWins hint；`resolutionOrder` 文案顺序同步反转（vitest 10/10 绿）
- [x] 6. i18n：10 语言 `settings.vendors.qoderAuth.envIgnoredStoredWins` + `resolutionOrder` 顺序修正（i18n 测试 81/81 绿）
- [x] 7. `cargo test qoder_auth` + `cargo build --workspace`（含 daemon target）+ `npx tsc --noEmit`（本 change 文件零 error；剩余 error 全部属于 in-flight `fix-topbar-tab-close-empty-canvas`）
- [x] 8. 基石文档校准回写：`docs/research/mossx-multi-cli-provider-session-foundation-design.md` 最近校准行 + Qoder protocol/runtime 行补「PAT 注入优先级 stored PAT > 进程 env（`qoder_auth.rs::select_spawn_pat`）」（ADR 校准回写 Gate）
- [x] 9. 用户验收后 verify + sync specs 归档
