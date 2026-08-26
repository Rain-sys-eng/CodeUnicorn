//! PI provider launch profile.
//!
//! PI uses native `~/.pi` auth and models.json — mossx does not materialize
//! multi-provider configs into PI's home (unlike kimi/grok). Launch profile
//! only isolates optional custom home / runtime key for session ownership.

use std::path::{Path, PathBuf};

use crate::session_management::EngineProviderBinding;

pub(crate) const PI_LOCAL_PROVIDER_PROFILE_ID: &str = "__local_pi__";

#[derive(Debug, Clone)]
pub(crate) struct PiProviderLaunchProfile {
    pub(crate) binding: Option<EngineProviderBinding>,
    pub(crate) home_dir: Option<PathBuf>,
    pub(crate) runtime_key: String,
}

fn normalize_profile_id(profile_id: Option<&str>) -> &str {
    profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(PI_LOCAL_PROVIDER_PROFILE_ID)
}

/// Runtime Key（Ownership 归属）：
/// - local（`__local_pi__` / 空）：= workspace_id（与 Native Pi 默认归属一致）
/// - named profile：`{workspace}::pi::{profile}`（与 kimi/grok named 形态对齐）
pub(crate) fn pi_runtime_key(workspace_id: &str, provider_profile_id: Option<&str>) -> String {
    let profile_id = normalize_profile_id(provider_profile_id);
    if profile_id == PI_LOCAL_PROVIDER_PROFILE_ID {
        workspace_id.to_string()
    } else {
        format!("{workspace_id}::pi::{profile_id}")
    }
}

/// Resolve PI launch profile. Custom profile ids are treated as local until
/// a future vendor CRUD lands; home always comes from optional env/settings
/// path via the engine config on the session, not from multi-provider store.
pub(crate) fn resolve_pi_provider_launch_profile(
    workspace_id: &str,
    provider_profile_id: Option<&str>,
    home_dir: Option<&Path>,
) -> Result<PiProviderLaunchProfile, String> {
    let runtime_key = pi_runtime_key(workspace_id, provider_profile_id);
    Ok(PiProviderLaunchProfile {
        binding: None,
        home_dir: home_dir.map(Path::to_path_buf),
        runtime_key,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_profile_uses_workspace_runtime_key() {
        let profile = resolve_pi_provider_launch_profile("ws-1", None, None).expect("profile");
        assert_eq!(profile.runtime_key, "ws-1");
        assert!(profile.binding.is_none());
    }

    #[test]
    fn named_profile_scopes_runtime_key() {
        let profile =
            resolve_pi_provider_launch_profile("ws-1", Some("custom"), None).expect("profile");
        assert_eq!(profile.runtime_key, "ws-1::pi::custom");
    }
}
