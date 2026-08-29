pub(crate) mod approval;
pub(crate) mod control;
pub(crate) mod dispatcher;
pub(crate) mod mcp_gateway;
pub(crate) mod mcp_runtime;
pub(crate) mod mcp_source;
pub mod models;
pub(crate) mod persistence;
pub(crate) mod presentation;
pub mod run_registry;
pub mod service;

pub use models::{
    AgentEndpoint, CreateDelegationRun, DelegationContextPolicy, DelegationDispatchBinding,
    DelegationExecutionScope, DelegationResult, DelegationRun, DelegationRunStatus,
};
pub(crate) use persistence::AgentBridgePersistence;
pub use run_registry::{DelegationRunLimits, DelegationRunRegistry};
pub use service::AgentBridgeService;
