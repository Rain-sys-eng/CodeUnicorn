//! 本地 embedding 命令面（当前无 ONNX Runtime）。
//!
//! 背景：`ort` / ONNX Runtime 预编译不提供 `x86_64-apple-darwin`，会导致 Intel macOS
//! 线上打包失败。按产品决策移除 `ort` 依赖，命令面保持兼容，health 诚实返回
//! unavailable，检索路径回退 lexical。
//!
//! 合约：
//! - health → status=unavailable, downloadable=false, reason=onnx_runtime_removed
//! - embed_text → Err（调用方 catch 后走 lexical）
//! - download → 拒绝（不再拉取模型文件）
//! - remove → 仍清理历史残留文件（若有）

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

const EMBEDDING_VERSION: &str = "memory-embed-v1";
const MODEL_ID: &str = "memory-embed-v1";
const PROVIDER_ID: &str = "mossx-bundled-onnx";
const DEFAULT_DIMENSIONS: usize = 384;
/// 与前端/设置页对齐的稳定 reason code。
const REASON_ONNX_RUNTIME_REMOVED: &str = "onnx_runtime_removed";

const ONNX_FILE_NAME: &str = "memory-embed-v1.onnx";
const TOKENIZER_FILE_NAME: &str = "tokenizer.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemoryEmbedHealth {
    pub status: String,
    pub reason: Option<String>,
    /// 固定 false：当前构建不提供 ONNX 下载/推理。
    pub downloadable: bool,
    pub provider_id: String,
    pub model_id: String,
    pub embedding_version: String,
    pub dimensions: usize,
    pub model_path: Option<String>,
    pub model_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemoryEmbedResult {
    pub vector: Vec<f32>,
    pub dimensions: usize,
    pub embedding_version: String,
    pub model_id: String,
}

/// 保留结构体以兼容事件契约；当前构建不再 emit 下载进度。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedDownloadProgress {
    pub phase: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

fn embed_model_ccgui_dir() -> Option<PathBuf> {
    crate::app_paths::app_home_dir()
        .ok()
        .map(|home| home.join("models").join("embedding"))
}

fn embed_model_legacy_app_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("models").join("embedding"))
}

fn embed_model_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let _ = app;
    embed_model_ccgui_dir()
}

fn download_tmp_path(dest: &Path) -> PathBuf {
    let file_name = dest
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("download.bin");
    dest.with_file_name(format!("{file_name}.download"))
}

fn remove_model_files_in_dir(model_dir: &Path) -> Result<(), String> {
    if !model_dir.exists() {
        return Ok(());
    }
    let onnx_path = model_dir.join(ONNX_FILE_NAME);
    let tokenizer_path = model_dir.join(TOKENIZER_FILE_NAME);
    let tmp_onnx = download_tmp_path(&onnx_path);
    let tmp_tok = download_tmp_path(&tokenizer_path);

    for path in [&onnx_path, &tokenizer_path, &tmp_onnx, &tmp_tok] {
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| format!("remove {}: {}", path.display(), e))?;
            log::info!("[embed] removed {}", path.display());
        }
    }
    let _ = std::fs::remove_dir(model_dir);
    Ok(())
}

fn disabled_health(app: &tauri::AppHandle) -> ProjectMemoryEmbedHealth {
    ProjectMemoryEmbedHealth {
        status: "unavailable".to_string(),
        reason: Some(REASON_ONNX_RUNTIME_REMOVED.to_string()),
        downloadable: false,
        provider_id: PROVIDER_ID.to_string(),
        model_id: MODEL_ID.to_string(),
        embedding_version: EMBEDDING_VERSION.to_string(),
        dimensions: DEFAULT_DIMENSIONS,
        model_path: None,
        model_dir: embed_model_data_dir(app).map(|p| p.display().to_string()),
    }
}

#[tauri::command]
pub(crate) async fn project_memory_embed_health(
    app: tauri::AppHandle,
) -> Result<ProjectMemoryEmbedHealth, String> {
    Ok(disabled_health(&app))
}

#[tauri::command]
pub(crate) async fn project_memory_embed_text(
    _app: tauri::AppHandle,
    _text: String,
) -> Result<ProjectMemoryEmbedResult, String> {
    Err(REASON_ONNX_RUNTIME_REMOVED.to_string())
}

#[tauri::command]
pub(crate) async fn project_memory_embed_download(
    app: tauri::AppHandle,
) -> Result<ProjectMemoryEmbedHealth, String> {
    log::info!("[embed] download rejected: ONNX runtime removed to restore Intel macOS packaging");
    Ok(disabled_health(&app))
}

/// 清理历史模型残留（用户目录 / 旧 app_data），便于磁盘回收。
#[tauri::command]
pub(crate) async fn project_memory_embed_remove(
    app: tauri::AppHandle,
) -> Result<ProjectMemoryEmbedHealth, String> {
    if let Some(model_dir) = embed_model_data_dir(&app) {
        remove_model_files_in_dir(&model_dir)?;
    }
    if let Some(legacy_dir) = embed_model_legacy_app_data_dir(&app) {
        if let Err(e) = remove_model_files_in_dir(&legacy_dir) {
            log::warn!("[embed] remove legacy dir failed: {}", e);
        }
    }
    Ok(disabled_health(&app))
}

/// 兼容测试辅助：当前无 runtime 缓存，no-op。
#[allow(dead_code)]
pub(crate) fn __reset_embedding_runtime_for_tests() {}
