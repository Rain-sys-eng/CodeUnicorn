//! Multi-Agent V1 control plane.
//!
//! 线性协作：Plan → user confirm → Execute（可选 Review）→ settle。
//! 复用 Shared Session ordinary turns + scoped binding；现有 V1 行为保持兼容。
//!
//! `bridge` 子域承载跨 engine Agent-to-Agent delegation control plane；
//! `graph` + `scheduler` + `graph_store` 提供 Bridge-backed Parallel / DAG orchestration。
//! 所有 runtime side effect 都必须经 Agent Bridge，禁止在 scheduler 内新增 CLI send/runtime owner。

pub mod bridge;
pub(crate) mod graph;
pub(crate) mod graph_store;
pub(crate) mod scheduler;
mod commands;
mod projection;
mod support;
mod types;
#[cfg(test)]
mod types_test;

pub(crate) use commands::*;
pub use projection::project_agent_runs;
pub use support::require_agent_enabled;
pub use types::*;
