use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeContextCapabilities {
    pub native_delta: bool,
    pub structured_history_import: bool,
    pub native_clone: bool,
    pub user_channel_transcript: bool,
    pub tool_history: bool,
    pub image_history: bool,
    pub strong_context_ack: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectionMode {
    NativeDelta,
    NativeHistoryImport,
    NativeHistoryClone,
    PortableTranscript,
    Checkpoint,
}

impl ProjectionMode {
    pub fn operation(self) -> &'static str {
        match self {
            Self::NativeDelta | Self::NativeHistoryImport | Self::NativeHistoryClone => {
                "context-import"
            }
            Self::PortableTranscript | Self::Checkpoint => "prompt-prefix",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OmissionDisposition {
    RetrievableOnDemand,
    NotRetrievable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionOmission {
    pub entry_id: String,
    pub category: String,
    pub reason: String,
    pub disposition: OmissionDisposition,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retrievable_ref: Option<String>,
}

impl ProjectionOmission {
    /// `destination-owned` 只是去重审计：目标 Native history 已持有该事实，
    /// 不代表跨 Binding 投影发生信息损失。
    pub fn requires_confirmation(&self) -> bool {
        self.category != "destination-owned"
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionManifest {
    pub compiler_version: String,
    pub mode: ProjectionMode,
    pub mode_reason: String,
    pub included_entry_ids: Vec<String>,
    pub omitted: Vec<ProjectionOmission>,
    pub from_sequence_exclusive: Option<i64>,
    pub through_sequence_inclusive: i64,
    pub source_checksum: String,
    /// Optional domain-owned compile scope. Squad uses this to bind package identity to the
    /// sealed node contract while ordinary Shared turns keep the field absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionCategory {
    pub category: String,
    pub strategy: String,
    pub source_estimated_tokens: u64,
    pub package_estimated_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCompressionReport {
    pub estimator: String,
    pub source_estimated_tokens: u64,
    pub package_estimated_tokens: u64,
    pub per_category: Vec<CompressionCategory>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableContextEntry {
    pub entry_id: String,
    pub sequence: i64,
    pub role: String,
    pub blocks: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ContextPackageSource {
    SharedCanonical {
        session_id: String,
        from_sequence_exclusive: Option<i64>,
        through_sequence_inclusive: i64,
    },
    NativeHistory {
        session_id: String,
        native_session_id: String,
        engine: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        provider_profile_id: Option<String>,
        reader_id: String,
        source_fingerprint: String,
        through_cursor: String,
    },
    DelegationPortable {
        run_id: String,
        context_policy: String,
        source_session_ids: Vec<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        inherited_package_ids: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPackage {
    pub schema_version: u32,
    pub package_id: String,
    pub session_id: String,
    pub binding_key: String,
    pub source: ContextPackageSource,
    pub destination: Value,
    pub stable_prefix: String,
    pub delta: Vec<PortableContextEntry>,
    pub prompt_prefix: String,
    pub manifest: ProjectionManifest,
    pub compression: ContextCompressionReport,
}

/// True when the package carries no transferable context (prompt-prefix or delta).
pub fn is_zero_transfer_package(package: &ContextPackage) -> bool {
    package.delta.is_empty() && package.prompt_prefix.trim().is_empty()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDelivery {
    pub package_id: String,
    pub source_checksum: String,
    pub through_sequence: i64,
    pub operation: String,
    pub phase: String,
    pub client_turn_id: String,
    pub attempt_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binding_operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_request_id: Option<String>,
    pub prepared_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepted_at: Option<i64>,
    pub probe_attempts: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedContextDelivery {
    pub package: ContextPackage,
    pub artifact_id: String,
    pub ack_fidelity: String,
}
