//! Tombstone-aware filter for disk-scan session list exports.
//!
//! Marker-first deletion (`session_delete_v2`) guarantees the index row is
//! tombstoned even when the physical file survives (MARKED_DELETED) or was
//! never touched (GHOST_CLEANED). Disk-scan list exports (engine history
//! lists, workspace catalog, opencode list) bypass the index and would
//! resurrect those rows into the sidebar minutes later. Every such export
//! retains through `TombstoneFilter` before returning.

use std::collections::HashSet;

use super::store;

/// Snapshot of all tombstoned session keys, pre-split for qoder raw matching.
#[derive(Debug, Default)]
pub(crate) struct TombstoneFilter {
    keys: HashSet<(String, String)>,
    /// qoder rows are indexed under canonical `qoder:<profile>:<raw>` ids while
    /// disk/ACP lists surface the raw id; both forms must match.
    qoder_raw_ids: HashSet<String>,
}

impl TombstoneFilter {
    /// Fail-open load: an unavailable index yields an empty filter (no
    /// filtering) so list availability never depends on index health.
    pub(crate) fn load_fail_open() -> Self {
        match store::open_connection()
            .and_then(|connection| store::list_tombstoned_session_keys(&connection))
        {
            Ok(keys) => Self::from_keys(keys),
            Err(error) => {
                log::warn!(
                    "[session_index.tombstone_filter] index unavailable, disk lists unfiltered: {error}"
                );
                Self::default()
            }
        }
    }

    pub(crate) fn from_keys(keys: HashSet<(String, String)>) -> Self {
        let mut qoder_raw_ids = HashSet::new();
        for (engine, session_id) in &keys {
            if engine != "qoder" {
                continue;
            }
            match crate::engine::qoder_provider_profile::parse_qoder_native_session_identity(
                session_id, None,
            ) {
                Ok(identity) => {
                    qoder_raw_ids.insert(identity.raw_session_id);
                }
                Err(_) => {
                    qoder_raw_ids.insert(session_id.clone());
                }
            }
        }
        Self {
            keys,
            qoder_raw_ids,
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// Engine-scoped exact match; tolerates `engine:`-prefixed ids.
    /// Never widens across engines.
    pub(crate) fn is_tombstoned(&self, engine: &str, session_id: &str) -> bool {
        if self.keys.is_empty() {
            return false;
        }
        let engine = engine.trim().to_ascii_lowercase();
        let id = session_id.trim();
        if id.is_empty() {
            return false;
        }
        if self.keys.contains(&(engine.clone(), id.to_string())) {
            return true;
        }
        let bare = store::strip_known_engine_prefix(id);
        if bare != id && self.keys.contains(&(engine.clone(), bare.to_string())) {
            return true;
        }
        if engine == "qoder" {
            if self.qoder_raw_ids.contains(id) {
                return true;
            }
            if bare != id && self.qoder_raw_ids.contains(bare) {
                return true;
            }
        }
        false
    }

    /// Retain only non-tombstoned sessions. `id_of` extracts the session id.
    /// `extra_id_of` optionally yields a second id form (e.g. catalog
    /// `canonical_session_id`) that is also checked.
    pub(crate) fn retain<T>(
        &self,
        engine: &str,
        sessions: &mut Vec<T>,
        id_of: impl Fn(&T) -> &str,
    ) {
        if self.is_empty() {
            return;
        }
        sessions.retain(|session| !self.is_tombstoned(engine, id_of(session)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(pairs: &[(&str, &str)]) -> HashSet<(String, String)> {
        pairs
            .iter()
            .map(|(engine, id)| (engine.to_string(), id.to_string()))
            .collect()
    }

    #[test]
    fn direct_match_filters_exact_engine_pair() {
        let filter = TombstoneFilter::from_keys(keys(&[("claude", "abc-1")]));
        assert!(filter.is_tombstoned("claude", "abc-1"));
        assert!(!filter.is_tombstoned("claude", "abc-2"));
        // 不跨 engine 扩大化
        assert!(!filter.is_tombstoned("codex", "abc-1"));
    }

    #[test]
    fn prefixed_id_matches_after_prefix_strip() {
        let filter = TombstoneFilter::from_keys(keys(&[("codex", "uuid-9")]));
        assert!(filter.is_tombstoned("codex", "codex:uuid-9"));
        assert!(filter.is_tombstoned("codex", "uuid-9"));
    }

    #[test]
    fn qoder_canonical_matches_raw_disk_id() {
        let filter =
            TombstoneFilter::from_keys(keys(&[("qoder", "qoder:__qoder_cn__:raw-uuid-1")]));
        assert!(filter.is_tombstoned("qoder", "raw-uuid-1"));
        assert!(filter.is_tombstoned("qoder", "qoder:__qoder_cn__:raw-uuid-1"));
        assert!(!filter.is_tombstoned("qoder", "raw-uuid-2"));
    }

    #[test]
    fn qoder_raw_marker_matches() {
        // 裸 id 删除路径给所有 engine 落 raw 标记（store.tombstone_session_ids）
        let filter = TombstoneFilter::from_keys(keys(&[("qoder", "raw-uuid-7")]));
        assert!(filter.is_tombstoned("qoder", "raw-uuid-7"));
    }

    #[test]
    fn empty_filter_is_inert() {
        let filter = TombstoneFilter::default();
        assert!(filter.is_empty());
        assert!(!filter.is_tombstoned("claude", "anything"));
        let mut sessions = vec!["a".to_string(), "b".to_string()];
        filter.retain("claude", &mut sessions, |s| s.as_str());
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn retain_drops_only_tombstoned() {
        let filter = TombstoneFilter::from_keys(keys(&[("pi", "p-1")]));
        let mut sessions = vec!["p-1".to_string(), "p-2".to_string()];
        filter.retain("pi", &mut sessions, |s| s.as_str());
        assert_eq!(sessions, vec!["p-2".to_string()]);
    }
}
