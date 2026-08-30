//! Shared Context Compiler（Change C）。
//!
//! Canonical Log 是唯一输入；本模块只生成派生 package，并通过 SharedEventWriter
//! 推进 delivery cursor。Renderer 不参与 checksum、sequence 或 cursor 计算。

mod artifact_store;
mod compiler;
mod delivery;
mod types;

pub use artifact_store::{
    read_artifact, read_typed_artifact, scan_orphan_artifacts, write_artifact,
    write_typed_artifact, ArtifactReadRequest, ArtifactStoreRecord, TypedArtifactStoreRecord,
};
pub use compiler::{
    compile_context, compile_context_including_squad_attempts, compile_native_context,
    compile_portable_context, session_needs_history, CompileContextRequest,
    CompileNativeContextRequest, CompilePortableContextRequest,
};
pub use delivery::{
    accept_delivery, commit_delivery, mark_delivery_sent, prepare_delivery,
    terminal_binding_update, AcceptDeliveryRequest, MarkDeliverySentRequest,
    PrepareDeliveryRequest,
};
pub use types::{is_zero_transfer_package, *};
