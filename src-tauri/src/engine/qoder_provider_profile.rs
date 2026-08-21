//! Qoder provider launch profile.
//!
//! Qoder has no API-key provider CRUD. Auth is browser login (`qodercli login`)
//! or PAT (`QODER_PERSONAL_ACCESS_TOKEN`, stored by mossx in qoder-auth.json).
//! This module only isolates optional custom home / runtime key for session
//! ownership, mirroring PI's launch-profile surface.

use std::path::{Path, PathBuf};

use crate::session_management::EngineProviderBinding;

pub(crate) const QODER_LOCAL_PROVIDER_PROFILE_ID: &str = "__local_qoder__";

#[derive(Debug, Clone)]
pub(crate) struct QoderProviderLaunchProfile {
    pub(crate) binding: Option<EngineProviderBinding>,
    pub(crate) home_dir: Option<PathBuf>,
    pub(crate) runtime_key: String,
}

fn normalize_profile_id(profile_id: Option<&str>) -> &str {
    profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(QODER_LOCAL_PROVIDER_PROFILE_ID)
}

/// Runtime Key (Ownership):
/// - local (`__local_qoder__` / empty): workspace_id
/// - named profile: `{workspace}::qoder::{profile}`
pub(crate) fn qoder_runtime_key(workspace_id: &str, provider_profile_id: Option<&str>) -> String {
    let profile_id = normalize_profile_id(provider_profile_id);
    if profile_id == QODER_LOCAL_PROVIDER_PROFILE_ID {
        workspace_id.to_string()
    } else {
        format!("{workspace_id}::qoder::{profile_id}")
    }
}

/// Resolve Qoder config-dir / home overlay.
///
/// Priority: explicit `home_dir` argument -> `QODER_HOME` -> `~/.qoder`.
pub(crate) fn resolve_qoder_home_dir(home_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(home_dir) = home_dir {
        return Some(home_dir.to_path_buf());
    }
    if let Ok(env_home) = std::env::var("QODER_HOME") {
        let trimmed = env_home.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    dirs::home_dir().map(|home| home.join(".qoder"))
}

/// Resolve Qoder launch profile. Custom profile ids are treated as local until
/// a future vendor CRUD lands; home always comes from optional env/settings
/// path via the engine config on the session, not from a multi-provider store.
pub(crate) fn resolve_qoder_provider_launch_profile(
    workspace_id: &str,
    provider_profile_id: Option<&str>,
    home_dir: Option<&Path>,
) -> Result<QoderProviderLaunchProfile, String> {
    let runtime_key = qoder_runtime_key(workspace_id, provider_profile_id);
    Ok(QoderProviderLaunchProfile {
        binding: None,
        home_dir: resolve_qoder_home_dir(home_dir),
        runtime_key,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_profile_uses_workspace_runtime_key() {
        let profile = resolve_qoder_provider_launch_profile("ws-1", None, None).expect("profile");
        assert_eq!(profile.runtime_key, "ws-1");
        assert!(profile.binding.is_none());
    }

    #[test]
    fn named_profile_scopes_runtime_key() {
        let profile =
            resolve_qoder_provider_launch_profile("ws-1", Some("custom"), None).expect("profile");
        assert_eq!(profile.runtime_key, "ws-1::qoder::custom");
    }

    #[test]
    fn local_sentinel_normalizes_to_workspace_key() {
        assert_eq!(
            qoder_runtime_key("ws-1", Some(QODER_LOCAL_PROVIDER_PROFILE_ID)),
            "ws-1"
        );
    }
}
