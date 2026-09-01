//! DSH does not own provider profiles in mossx. Keys and catalog live in DSH.

pub(crate) const DSH_LOCAL_PROVIDER_PROFILE_ID: &str = "__dsh_host_catalog__";

/// DSH owns one application-wide Host RPC process, while Shared/Bridge ownership must still be
/// workspace-scoped so identical native ids cannot be attributed across workspaces.
pub(crate) fn dsh_runtime_key(workspace_id: &str) -> String {
    format!("dsh::{workspace_id}")
}

pub(crate) fn resolve_dsh_provider_model_config(
    _provider_profile_id: &str,
) -> Result<Option<()>, String> {
    Ok(None)
}
