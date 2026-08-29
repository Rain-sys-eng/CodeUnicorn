//! Multi-Agent V1 control plane.
//!
//! 线性协作：Plan → user confirm → Execute（可选 Review）→ settle。
//! 复用 Shared Session ordinary turns + scoped binding；现有 V1 行为保持兼容。
//!
//! `bridge` 子域承载跨 engine Agent-to-Agent delegation control plane；
//! `graph` 提供 Bridge-backed Parallel / DAG orchestration 的纯计划模型，实际 runtime
//! side effect 仍必须由后续 scheduler 通过 Agent Bridge 发起。

pub mod bridge;
pub(crate) mod graph;
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
