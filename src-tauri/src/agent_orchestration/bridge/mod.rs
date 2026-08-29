pub(crate) mod dispatcher;
pub mod models;
pub(crate) mod persistence;
pub mod run_registry;
pub mod service;

pub use models::{
    AgentEndpoint, CreateDelegationRun, DelegationContextPolicy, DelegationDispatchBinding,
    DelegationExecutionScope, DelegationResult, DelegationRun, DelegationRunStatus,
};
pub(crate) use persistence::AgentBridgePersistence;
pub use run_registry::{DelegationRunLimits, DelegationRunRegistry};
pub use service::AgentBridgeService;
