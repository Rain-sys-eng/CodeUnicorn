//! Sidebar session index: list-level SQLite cache for multi-engine histories.
//!
//! Design goals:
//! - Sidebar cold path reads SQL only (O(limit)), never full JSONL inventory.
//! - Writers prefer native light indexes (Claude history.jsonl, Codex session_index)
//!   and bounded recent-first file walks.
//! - Full multi-engine catalog projection remains Session Management / explicit refresh.

pub(crate) mod commands;
mod empty_prune;
pub(crate) mod importer;
pub(crate) mod shared_visibility;
pub(crate) mod store;
pub(crate) mod tombstone_filter;
mod writers;
