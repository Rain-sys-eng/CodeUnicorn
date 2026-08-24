# fix-qoder-pat-env-precedence design

## D1：优先级反转的实现位置

现状（`src-tauri/src/engine/qoder_auth.rs`）：

```rust
pub(crate) fn resolve_qoder_pat_for_spawn_for_distribution(
    distribution: QoderDistribution,
) -> Option<String> {
    if qoder_process_env_has_pat_for_distribution(distribution) {
        return None; // 子进程继承 mossx 进程 env
    }
    stored_qoder_pat_for_distribution_sync(distribution)
}
```

改为：

```rust
pub(crate) fn resolve_qoder_pat_for_spawn_for_distribution(
    distribution: QoderDistribution,
) -> Option<String> {
    select_spawn_pat(
        stored_qoder_pat_for_distribution_sync(distribution),
        process_env_pat_for_distribution(distribution),
    )
}

/// 纯函数：stored 优先（Some → 显式 cmd.env 覆盖继承值）；
/// 无 stored 时返回 None，让 child 直接继承进程 env（不重复注入）。
fn select_spawn_pat(stored: Option<String>, _env: Option<String>) -> Option<String> {
    stored
}
```

语义表：

| stored | env | 返回值 | 子进程实际生效 |
|--------|-----|--------|----------------|
| 有 | 有 | `Some(stored)` | **stored**（`cmd.env` 显式覆盖继承） |
| 有 | 无 | `Some(stored)` | stored |
| 无 | 有 | `None` | env（继承，行为不变） |
| 无 | 无 | `None` | 无凭据 |

`apply_qoder_pat_env_for_distribution` 的 `env_remove(other_distribution)` 隔离保持不变。

## D2：可测性——纯函数抽取

`resolve_*` 读真实 `~/.ccgui` 与进程 env，单测不可控（Rust 测试并行，`std::env::set_var` 全局竞态）。把判定抽成纯函数 `select_spawn_pat(stored, env)`，单测只测纯函数四种组合 + 验证显式 `cmd.env` 覆盖继承（用 `Command::as_std().get_envs()` 断言，现有测试同款手法），不在测试中 set_var。

## D3：status 可见性

`QoderAuthStatus` 增加：

```rust
pub env_present: bool, // serde camelCase → envPresent
```

- `state` 语义不变（stored→`configured`；仅 env→`env`；皆无→`none`）——修复后 state 与真实生效凭据一致。
- 前端 `QoderAuthSection`：`state === "configured" && envPresent` 时显示新 hint「进程环境变量中同时存在 {{envVar}}，已被忽略，以保存的 PAT 为准」；`state === "env"` 路径沿用现有 `envActiveHint`（修复后「设置 PAT 可覆盖」文案变为真）。

## D4：i18n 面

新增一个 key：`settings.vendors.qoderAuth.envIgnoredStoredWins`，10 语言（en / zh / zh-TW / es / fr / hi / ja / ko / pt-BR / ru）。zh 为主文案，其余语言直译。

## D5：不改动的面

- `qoder_has_pat_credential_for_distribution`：doctor「有无凭据」判定不受优先级影响（env OR stored）。
- `probe_qoder_logged_in` / models probe / doctor spawn 全部经由同一 `apply_qoder_pat_env_for_distribution`，自动一致。
- daemon（`engine_bridge.rs` 影子 include `qoder_auth.rs`）与 remote `call_remote` 路径零改动获得修复。

## 风险

| 风险 | 评估 |
|------|------|
| 故意用 env 覆盖 stored 的用户行为变化 | UI 文案一直承诺 stored 覆盖 env，代码是 outlier；变化即修复 |
| stored 是旧值、env 是新值的反向场景 | status 新增 `envPresent` + UI hint 让该状态可见，用户删 stored 即回退 env |
| 测试竞态 | D2 纯函数抽取规避 set_var |

## 验证

- `cargo test qoder_auth`（含新优先级四组合 + env_remove 隔离回归）
- `cargo build --workspace`（daemon target 同编译）
- `npx tsc --noEmit`；QoderAuthSection focused vitest（若已有覆盖）
- `openspec validate fix-qoder-pat-env-precedence --strict --no-interactive`
