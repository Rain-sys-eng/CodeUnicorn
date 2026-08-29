//! Multi-Agent V1 control plane.
//!
//! 线性协作：Plan → user confirm → Execute（可选 Review）→ settle。
//! 复用 Shared Session ordinary turns + scoped binding；不做 DAG scheduler。
//!
//! `bridge` 子域承载跨 engine Agent-to-Agent delegation control plane；
//! 现有 V1 stage workflow 保持兼容，后续可逐步改为 Bridge consumer。

pub mod bridge;
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
