use std::collections::HashSet;

use serde_json::json;

use crate::shared_event_log::canonical::types::{CanonicalFact, ControlFact};
use crate::shared_event_log::SharedEventWriter;
use crate::shared_sessions::{now_millis, parse_shared_session_id};

use super::service::AgentBridgeService;

pub const INTERNAL_BACKING_SESSION_CONTROL_KIND: &str =
    "agent-bridge.internalBackingSession";

/// Persist the presentation-only identity of an Agent Bridge backing Shared Session.
///
/// The backing session remains a real Shared V2 owner for binding/recovery purposes. This marker
/// only gives presentation surfaces a durable, restart-safe way to hide it from ordinary Shared
/// Session navigation. ControlFact has no native dedupe key, so idempotency is established by
/// scanning the session's canonical facts before appending.
pub(crate) fn ensure_internal_backing_session_marker(
    writer: &SharedEventWriter,
    backing_thread_id: &str,
    bridge_run_id: Option<&str>,
) -> Result<bool, String> {
    let session_id = parse_shared_session_id(backing_thread_id)?;
    let events = writer
        .events_for_session(&session_id)
        .map_err(|error| error.to_string())?;
    let already_marked = events.into_iter().any(|event| {
        if event.fact_type != "conversation.controlFact" {
            return false;
        }
        serde_json::from_str::<CanonicalFact>(&event.payload_json)
            .ok()
            .and_then(|fact| match fact {
                CanonicalFact::Control(control) => Some(control.control_kind),
                _ => None,
            })
            .is_some_and(|kind| kind == INTERNAL_BACKING_SESSION_CONTROL_KIND)
    });
    if already_marked {
        return Ok(false);
    }

    let committed_at = i64::try_from(now_millis()).unwrap_or(i64::MAX);
    writer
        .append_canonical_fact_at(
            session_id,
            CanonicalFact::Control(ControlFact {
                control_kind: INTERNAL_BACKING_SESSION_CONTROL_KIND.to_string(),
                logical_turn_id: None,
                attempt_id: None,
                binding_key: None,
                reason: Some("internal Agent Bridge backing lane".to_string()),
                details: Some(json!({
                    "surface": "agent-bridge",
                    "bridgeRunId": bridge_run_id,
                })),
                extra: json!({}),
            }),
            committed_at,
        )
        .map_err(|error| error.to_string())?;
    Ok(true)
}

/// Repair the crash window between Shared Session creation and marker persistence.
/// Durable DelegationRun backing identities are the authority after restart; missing markers are
/// recreated without changing or deleting any Shared binding/native-session ownership.
pub(crate) fn reconcile_internal_backing_session_markers(
    service: &AgentBridgeService,
    writer: &SharedEventWriter,
) -> Result<usize, String> {
    let mut repaired = 0usize;
    let mut seen = HashSet::new();
    for run in service.list_runs()? {
        let Some(binding) = run.dispatch_binding.as_ref() else {
            continue;
        };
        if !seen.insert(binding.backing_thread_id.clone()) {
            continue;
        }
        if ensure_internal_backing_session_marker(
            writer,
            &binding.backing_thread_id,
            Some(&run.id),
        )? {
            repaired += 1;
        }
    }
    Ok(repaired)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_kind_is_namespaced_and_stable() {
        assert_eq!(
            INTERNAL_BACKING_SESSION_CONTROL_KIND,
            "agent-bridge.internalBackingSession"
        );
    }
}
