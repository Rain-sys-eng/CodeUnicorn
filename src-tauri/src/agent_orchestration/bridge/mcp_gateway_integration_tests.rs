use std::sync::{Arc, Mutex};

use serde_json::json;

use super::*;
use crate::agent_orchestration::bridge::{
    AgentBridgePersistence, AgentBridgeService, DelegationDispatchBinding, DelegationResult,
    DelegationRunLimits, DelegationRunRegistry, DelegationRunStatus,
};
use crate::engine::{EngineManager, ModelInfo};
use crate::types::AppSettings;

struct FakeMcpRuntime {
    service: Arc<AgentBridgeService>,
    engine_manager: EngineManager,
    settings: AppSettings,
    workspace_id: String,
    calls: Mutex<Vec<String>>,
}

impl FakeMcpRuntime {
    async fn new() -> Self {
        Self::with_service(AgentBridgeService::new(DelegationRunRegistry::new(
            Default::default(),
        )))
        .await
    }

    async fn with_service(service: AgentBridgeService) -> Self {
        let engine_manager = EngineManager::new();
        cache_installed_engine(&engine_manager, EngineType::Claude, "claude-sonnet").await;
        cache_installed_engine(&engine_manager, EngineType::Codex, "gpt-5.6-sol").await;
        Self {
            service: Arc::new(service),
            engine_manager,
            settings: AppSettings::default(),
            workspace_id: "workspace-1".to_string(),
            calls: Mutex::new(Vec::new()),
        }
    }

    fn record_call(&self, call: impl Into<String>) {
        self.calls
            .lock()
            .expect("fake calls lock")
            .push(call.into());
    }

    fn complete(&self, run_id: &str, summary: &str) -> DelegationRun {
        self.service
            .settle_completed(
                run_id,
                DelegationResult {
                    summary: Some(summary.to_string()),
                    changed_files: vec!["src/lib.rs".to_string()],
                    branch: None,
                    diff: Some("+delegated change".to_string()),
                    artifact_path: None,
                },
            )
            .expect("fake completion")
    }

    fn fail(&self, run_id: &str, error: &str) -> DelegationRun {
        self.service
            .settle_failed(run_id, error.to_string())
            .expect("fake failure")
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().expect("fake calls lock").clone()
    }
}

impl AgentBridgeMcpBackend for FakeMcpRuntime {
    fn list_agents(&self) -> McpBackendFuture<'_, Value> {
        self.record_call("list");
        Box::pin(async move { agent_list_from_runtime(&self.engine_manager, &self.settings).await })
    }

    fn create_run(&self, request: CreateDelegationRun) -> McpBackendFuture<'_, DelegationRun> {
        self.record_call("create");
        Box::pin(async move {
            if request.workspace_id != self.workspace_id {
                return Err(format!(
                    "workspace not found for fake Agent Bridge runtime: {}",
                    request.workspace_id
                ));
            }
            self.service
                .create_run(request, &self.engine_manager, &self.settings)
                .await
        })
    }

    fn dispatch_run(&self, run_id: String) -> McpBackendFuture<'_, DelegationRun> {
        self.record_call(format!("dispatch:{run_id}"));
        Box::pin(async move {
            let claimed = self.service.claim_dispatch(&run_id)?;
            let previous_binding = claimed
                .continuation_of_run_id
                .as_deref()
                .map(|previous_run_id| {
                    self.service
                        .get_run(previous_run_id)?
                        .and_then(|run| run.dispatch_binding)
                        .ok_or_else(|| {
                            format!("fake continuation owner has no binding: {previous_run_id}")
                        })
                })
                .transpose()?;
            let backing_thread_id = previous_binding
                .as_ref()
                .map(|binding| binding.backing_thread_id.clone())
                .unwrap_or_else(|| format!("shared:fake:{run_id}"));
            let native_session_id = previous_binding
                .as_ref()
                .and_then(|binding| binding.native_session_id.clone())
                .unwrap_or_else(|| format!("native:fake:{run_id}"));
            let binding_key = previous_binding
                .as_ref()
                .map(|binding| binding.binding_key.clone())
                .unwrap_or_else(|| format!("binding:fake:{run_id}"));
            let attempt_id = format!("attempt:fake:{run_id}");
            let runtime_turn_id = format!("turn:fake:{run_id}");
            self.service.set_dispatch_binding(
                &run_id,
                DelegationDispatchBinding {
                    backing_thread_id,
                    attempt_id: attempt_id.clone(),
                    logical_turn_id: format!("logical:fake:{run_id}"),
                    binding_key,
                    runtime_workspace_id: Some(self.workspace_id.clone()),
                    native_session_id: None,
                    runtime_turn_id: None,
                    context_transfer: None,
                },
            )?;
            self.service.record_runtime_ack(
                &run_id,
                &attempt_id,
                &native_session_id,
                &runtime_turn_id,
            )
        })
    }

    fn create_continuation(
        &self,
        previous_run_id: String,
        task: String,
    ) -> McpBackendFuture<'_, DelegationRun> {
        self.record_call(format!("continue:{previous_run_id}"));
        Box::pin(async move {
            self.service
                .continue_run(&previous_run_id, task, &self.engine_manager, &self.settings)
                .await
        })
    }

    fn cancel_run(&self, run_id: String) -> McpBackendFuture<'_, DelegationRun> {
        self.record_call(format!("cancel:{run_id}"));
        Box::pin(async move { self.service.cancel(&run_id) })
    }

    fn get_run(&self, run_id: &str) -> Result<Option<DelegationRun>, String> {
        self.service.get_run(run_id)
    }

    fn list_runs(&self) -> Result<Vec<DelegationRun>, String> {
        self.service.list_runs()
    }
}

async fn cache_installed_engine(manager: &EngineManager, engine: EngineType, model_id: &str) {
    let mut status = crate::engine::disabled_engine_status(engine);
    status.installed = true;
    status.error = None;
    status.models = vec![ModelInfo::new(model_id, model_id).as_default()];
    status.default_model = Some(model_id.to_string());
    manager.cache_engine_status(status).await;
}

fn resolved_source(
    engine: &str,
    logical: Option<&str>,
    native: Option<&str>,
    runtime_turn_id: &str,
) -> ResolvedMcpSource {
    ResolvedMcpSource {
        endpoint: AgentEndpoint {
            engine_id: engine.to_string(),
            logical_session_id: logical.map(str::to_string),
            native_session_id: native.map(str::to_string),
        },
        runtime_turn_id: runtime_turn_id.to_string(),
    }
}

#[tokio::test]
async fn seven_tools_close_the_delegate_wait_result_send_cancel_loop() {
    let runtime = FakeMcpRuntime::new().await;
    let source = resolved_source(
        "claude",
        Some("runtime-claude"),
        Some("native-claude"),
        "turn-claude",
    );
    let agents = call_tool_with_backend(
        &runtime,
        "workspace-1",
        source.clone(),
        AGENT_LIST_TOOL,
        json!({}),
    )
    .await
    .expect("agent_list");
    assert_eq!(agents["agents"].as_array().map(Vec::len), Some(9));
    assert_eq!(
        agents["agents"]
            .as_array()
            .and_then(|agents| agents.iter().find(|agent| agent["engineId"] == "codex"))
            .and_then(|agent| agent["installed"].as_bool()),
        Some(true)
    );

    let delegated: DelegationRun = serde_json::from_value(
        call_tool_with_backend(
            &runtime,
            "workspace-1",
            source.clone(),
            AGENT_DELEGATE_TOOL,
            json!({
                "targetEngine": "codex",
                "task": "review the bridge",
                "fileRefs": ["src/lib.rs"]
            }),
        )
        .await
        .expect("agent_delegate"),
    )
    .expect("delegated run");
    assert_eq!(delegated.status, DelegationRunStatus::Running);
    assert_eq!(delegated.source, source.endpoint);
    let first_binding = delegated
        .dispatch_binding
        .clone()
        .expect("fake dispatch binding");

    let status: DelegationRun = serde_json::from_value(
        call_tool_with_backend(
            &runtime,
            "workspace-1",
            source.clone(),
            AGENT_STATUS_TOOL,
            json!({"runId": delegated.id}),
        )
        .await
        .expect("agent_status"),
    )
    .expect("status run");
    assert_eq!(status.status, DelegationRunStatus::Running);

    runtime
        .service
        .transition(&delegated.id, DelegationRunStatus::WaitingApproval)
        .expect("fake approval request");
    let waiting: DelegationRun = serde_json::from_value(
        call_tool_with_backend(
            &runtime,
            "workspace-1",
            source.clone(),
            AGENT_STATUS_TOOL,
            json!({"runId": delegated.id}),
        )
        .await
        .expect("approval status"),
    )
    .expect("waiting run");
    assert_eq!(waiting.status, DelegationRunStatus::WaitingApproval);

    let pending = call_tool_with_backend(
        &runtime,
        "workspace-1",
        source.clone(),
        AGENT_WAIT_TOOL,
        json!({"runId": delegated.id, "timeoutMs": 0}),
    )
    .await
    .expect("bounded pending wait");
    assert_eq!(pending["settled"], false);
    assert_eq!(pending["run"]["status"], "waitingApproval");

    runtime
        .service
        .transition(&delegated.id, DelegationRunStatus::Running)
        .expect("fake approval accepted");
    let settle_runtime = async {
        tokio::time::sleep(Duration::from_millis(10)).await;
        runtime.complete(&delegated.id, "review complete")
    };
    let wait_runtime = call_tool_with_backend(
        &runtime,
        "workspace-1",
        source.clone(),
        AGENT_WAIT_TOOL,
        json!({"runId": delegated.id, "timeoutMs": 500}),
    );
    let (_, settled) = tokio::join!(settle_runtime, wait_runtime);
    let settled = settled.expect("settled wait");
    assert_eq!(settled["settled"], true);
    assert_eq!(settled["run"]["status"], "completed");

    let result = call_tool_with_backend(
        &runtime,
        "workspace-1",
        source.clone(),
        AGENT_RESULT_TOOL,
        json!({"runId": delegated.id}),
    )
    .await
    .expect("agent_result");
    assert_eq!(result["settled"], true);
    assert_eq!(result["result"]["summary"], "review complete");

    let continuation: DelegationRun = serde_json::from_value(
        call_tool_with_backend(
            &runtime,
            "workspace-1",
            source.clone(),
            AGENT_SEND_TOOL,
            json!({"runId": delegated.id, "task": "check the remaining edge case"}),
        )
        .await
        .expect("agent_send"),
    )
    .expect("continuation run");
    assert_ne!(continuation.id, delegated.id);
    assert_eq!(
        continuation.continuation_of_run_id.as_deref(),
        Some(delegated.id.as_str())
    );
    let continuation_binding = continuation
        .dispatch_binding
        .as_ref()
        .expect("continuation binding");
    assert_eq!(
        continuation_binding.backing_thread_id,
        first_binding.backing_thread_id
    );
    assert_eq!(
        continuation_binding.native_session_id,
        first_binding.native_session_id
    );
    assert_eq!(continuation_binding.binding_key, first_binding.binding_key);

    let cancelled: DelegationRun = serde_json::from_value(
        call_tool_with_backend(
            &runtime,
            "workspace-1",
            source,
            AGENT_CANCEL_TOOL,
            json!({"runId": continuation.id}),
        )
        .await
        .expect("agent_cancel"),
    )
    .expect("cancelled run");
    assert_eq!(cancelled.status, DelegationRunStatus::Cancelled);

    let calls = runtime.calls();
    assert_eq!(calls.first().map(String::as_str), Some("list"));
    assert_eq!(
        calls
            .iter()
            .filter(|call| call.as_str() == "create")
            .count(),
        1
    );
    assert!(calls
        .iter()
        .any(|call| call == &format!("continue:{}", delegated.id)));
    assert!(calls
        .iter()
        .any(|call| call == &format!("cancel:{}", continuation.id)));
}

#[tokio::test]
async fn approval_rejection_is_returned_as_a_failed_canonical_result() {
    let runtime = FakeMcpRuntime::new().await;
    let source = resolved_source(
        "claude",
        Some("runtime-claude"),
        Some("native-claude"),
        "turn-claude",
    );
    let delegated: DelegationRun = serde_json::from_value(
        call_tool_with_backend(
            &runtime,
            "workspace-1",
            source.clone(),
            AGENT_DELEGATE_TOOL,
            json!({"targetEngine": "codex", "task": "request protected write"}),
        )
        .await
        .expect("delegate"),
    )
    .expect("delegated run");
    runtime
        .service
        .transition(&delegated.id, DelegationRunStatus::WaitingApproval)
        .expect("approval request");
    runtime.fail(&delegated.id, "approval rejected: request-1");

    let result = call_tool_with_backend(
        &runtime,
        "workspace-1",
        source,
        AGENT_RESULT_TOOL,
        json!({"runId": delegated.id}),
    )
    .await
    .expect("failed result");
    assert_eq!(result["status"], "failed");
    assert_eq!(result["settled"], true);
    assert_eq!(result["error"], "approval rejected: request-1");
}

#[tokio::test]
async fn nested_delegate_uses_exact_runtime_owner_as_parent() {
    let runtime = FakeMcpRuntime::new().await;
    let root_source = resolved_source(
        "claude",
        Some("runtime-claude"),
        Some("native-claude"),
        "turn-claude",
    );
    let parent: DelegationRun = serde_json::from_value(
        call_tool_with_backend(
            &runtime,
            "workspace-1",
            root_source,
            AGENT_DELEGATE_TOOL,
            json!({"targetEngine": "codex", "task": "coordinate child"}),
        )
        .await
        .expect("parent delegate"),
    )
    .expect("parent run");
    let parent_binding = parent.dispatch_binding.as_ref().expect("parent binding");
    let child_source = resolved_source(
        "codex",
        Some("runtime-codex"),
        parent_binding.native_session_id.as_deref(),
        parent_binding
            .runtime_turn_id
            .as_deref()
            .expect("parent runtime turn"),
    );
    let child: DelegationRun = serde_json::from_value(
        call_tool_with_backend(
            &runtime,
            "workspace-1",
            child_source,
            AGENT_DELEGATE_TOOL,
            json!({"targetEngine": "claude", "task": "review nested output"}),
        )
        .await
        .expect("nested delegate"),
    )
    .expect("child run");
    assert_eq!(child.parent_run_id.as_deref(), Some(parent.id.as_str()));
    assert_eq!(child.root_run_id, parent.root_run_id);
    assert_eq!(child.depth, parent.depth + 1);
    assert_eq!(child.source.engine_id, parent.target.engine_id);
}

#[tokio::test]
async fn source_and_workspace_ownership_fail_closed_before_control() {
    let runtime = FakeMcpRuntime::new().await;
    let owner = resolved_source(
        "claude",
        Some("runtime-owner"),
        Some("native-owner"),
        "turn-owner",
    );
    let delegated: DelegationRun = serde_json::from_value(
        call_tool_with_backend(
            &runtime,
            "workspace-1",
            owner,
            AGENT_DELEGATE_TOOL,
            json!({"targetEngine": "codex", "task": "owned task"}),
        )
        .await
        .expect("delegate"),
    )
    .expect("owned run");
    let attacker = resolved_source(
        "claude",
        Some("runtime-attacker"),
        Some("native-attacker"),
        "turn-attacker",
    );
    let source_error = call_tool_with_backend(
        &runtime,
        "workspace-1",
        attacker.clone(),
        AGENT_CANCEL_TOOL,
        json!({"runId": delegated.id}),
    )
    .await
    .expect_err("foreign source must fail closed");
    assert!(source_error.contains("source mismatch"));

    let workspace_error = call_tool_with_backend(
        &runtime,
        "workspace-2",
        attacker,
        AGENT_STATUS_TOOL,
        json!({"runId": delegated.id}),
    )
    .await
    .expect_err("foreign workspace must fail closed");
    assert!(workspace_error.contains("workspace mismatch"));
    assert_eq!(
        runtime
            .service
            .get_run(&delegated.id)
            .expect("run lookup")
            .expect("run remains")
            .status,
        DelegationRunStatus::Running
    );
}

#[tokio::test]
async fn recovered_stale_runtime_is_visible_as_failed_through_agent_result() {
    let root = std::env::temp_dir().join(format!(
        "agent-bridge-mcp-recovery-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).expect("create recovery fixture");
    let path = root.join("runs.json");
    let registry = DelegationRunRegistry::persistent(
        AgentBridgePersistence::new(path.clone()),
        DelegationRunLimits::default(),
    );
    let runtime = FakeMcpRuntime::with_service(AgentBridgeService::new(registry)).await;
    let source = resolved_source(
        "claude",
        Some("runtime-owner"),
        Some("native-owner"),
        "turn-owner",
    );
    let delegated: DelegationRun = serde_json::from_value(
        call_tool_with_backend(
            &runtime,
            "workspace-1",
            source.clone(),
            AGENT_DELEGATE_TOOL,
            json!({"targetEngine": "codex", "task": "survive restart"}),
        )
        .await
        .expect("delegate before restart"),
    )
    .expect("delegated run");
    assert_eq!(delegated.status, DelegationRunStatus::Running);
    drop(runtime);

    let recovered_registry = DelegationRunRegistry::persistent(
        AgentBridgePersistence::new(path),
        DelegationRunLimits::default(),
    );
    let recovered = FakeMcpRuntime::with_service(AgentBridgeService::new(recovered_registry)).await;
    let result = call_tool_with_backend(
        &recovered,
        "workspace-1",
        source,
        AGENT_RESULT_TOOL,
        json!({"runId": delegated.id}),
    )
    .await
    .expect("recovered result");
    assert_eq!(result["status"], "failed");
    assert_eq!(result["settled"], true);
    assert!(result["error"]
        .as_str()
        .is_some_and(|error| error.contains("recovery-required")));
    std::fs::remove_dir_all(root).ok();
}
