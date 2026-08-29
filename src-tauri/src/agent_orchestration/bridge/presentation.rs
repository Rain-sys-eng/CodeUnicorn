use std::collections::BTreeMap;

use crate::shared_event_log::canonical::types::{CanonicalFact, ControlFact};
use crate::shared_event_log::SharedEventWriter;
use crate::shared_sessions::{now_millis, parse_shared_session_id};

use super::service::AgentBridgeService;

pub(crate) const BRIDGE_INTERNAL_BACKING_CONTROL_KIND: &str =
    "agent-bridge.internalBackingSession";

pub(crate) fn session_has_internal_backing_marker(
    writer: &SharedEventWriter,
    shared_session_id: &str,
) -> Result<bool, String> {
    for event in writer
        .events_for_session(shared_session_id)
        .map_err(|error| error.to_string())?
    {
        let fact = match serde_json::from_str::<CanonicalFact>(&event.payload_json) {
            Ok(fact) => fact,
            Err(_) => continue,
        };
        if let CanonicalFact::Control(control) = fact {
            if control.control_kind == BRIDGE_INTERNAL_BACKING_CONTROL_KIND {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Persist a canonical presentation marker on the Shared session used as an Agent Bridge lane.
///
/// This marker never changes Shared/native ownership. It is only an independent durable signal
/// that ordinary Shared-session presentation must hide this logical lane.
pub(crate) fn ensure_backing_session_hidden(
    writer: &SharedEventWriter,
    backing_thread_id: &str,
    owner_run_id: &str,
) -> Result<(), String> {
    let shared_session_id = parse_shared_session_id(backing_thread_id)?;
    if session_has_internal_backing_marker(writer, &shared_session_id)? {
        return Ok(());
    }

    writer
        .append_canonical_fact(
            shared_session_id,
            CanonicalFact::Control(ControlFact {
                fact_id: format!("agent-bridge:{owner_run_id}:internal-backing-session"),
                control_kind: BRIDGE_INTERNAL_BACKING_CONTROL_KIND.to_string(),
                logical_turn_id: None,
                attempt_id: None,
                binding_key: None,
                reason: Some(format!("Agent Bridge backing lane for {owner_run_id}")),
                controlled_at: i64::try_from(now_millis()).unwrap_or(i64::MAX),
            }),
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Repair presentation markers after restart from the durable Bridge run registry.
///
/// The first run owning each backing thread is used only as marker provenance. Continuations may
/// share the same thread/native binding and therefore intentionally collapse to one marker.
pub(crate) fn reconcile_backing_session_markers(
    service: &AgentBridgeService,
    writer: &SharedEventWriter,
) -> Result<usize, String> {
    let mut owners = BTreeMap::<String, String>::new();
    for run in service.list_runs()? {
        let Some(binding) = run.dispatch_binding.as_ref() else {
            continue;
        };
        owners
            .entry(binding.backing_thread_id.clone())
            .or_insert_with(|| run.id.clone());
    }

    let mut repaired = 0usize;
    for (backing_thread_id, owner_run_id) in owners {
        let shared_session_id = parse_shared_session_id(&backing_thread_id)?;
        if session_has_internal_backing_marker(writer, &shared_session_id)? {
            continue;
        }
        ensure_backing_session_hidden(writer, &backing_thread_id, &owner_run_id)?;
        repaired += 1;
    }
    Ok(repaired)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_kind_is_namespaced_and_stable() {
        assert_eq!(
            BRIDGE_INTERNAL_BACKING_CONTROL_KIND,
            "agent-bridge.internalBackingSession"
        );
    }
}
