use std::sync::{Arc, OnceLock};

use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

use super::AgentBridgeService;

pub(crate) const AGENT_BRIDGE_EVENT: &str = "agent-bridge-event";
const UI_EVENT_CAPACITY: usize = 256;
static UI_OBSERVER_STARTED: OnceLock<()> = OnceLock::new();

/// Forward only already re-attributed Bridge events to the renderer.
///
/// This is a presentation adapter over the existing process-wide `AgentEventBus`; it neither
/// creates another bus nor owns runtime state. Frontend consumers subscribe locally and hydrate
/// durable snapshots through workspace-scoped commands after reload.
pub(crate) fn ensure_observer_started(app: &AppHandle) -> Result<(), String> {
    if UI_OBSERVER_STARTED.get().is_some() {
        return Ok(());
    }
    let state = app.state::<AppState>();
    let service = Arc::clone(&state.agent_bridge);
    let mut subscription = state
        .engine_manager
        .agent_event_bus()
        .subscribe(UI_EVENT_CAPACITY);
    let app = app.clone();
    UI_OBSERVER_STARTED
        .set(())
        .map_err(|_| "Agent Bridge UI observer was initialized concurrently".to_string())?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = subscription.recv().await {
            match service.get_run(&event.run_id) {
                Ok(Some(_)) => {
                    if let Err(error) = app.emit(AGENT_BRIDGE_EVENT, &event) {
                        log::warn!(
                            "[agent-bridge] failed to forward UI event for run {}: {}",
                            event.run_id,
                            error
                        );
                    }
                }
                Ok(None) => {}
                Err(error) => log::warn!(
                    "[agent-bridge] failed to verify UI event ownership for run {}: {}",
                    event.run_id,
                    error
                ),
            }
        }
    });
    Ok(())
}
