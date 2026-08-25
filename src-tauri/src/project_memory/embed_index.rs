//! workspace 旁路向量索引 `embed-index.v1.json`（不替换 JSON 主库）。
//!
//! 降级合约：
//! - 索引文件不存在 → 返回空（首次使用/清空后正常）
//! - 索引文件损坏 → 备份为 .json.bak，返回空 → 渐进重建

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::store::{resolve_workspace_dir, run_project_memory_io};

const INDEX_FILE_NAME: &str = "embed-index.v1.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedIndexRecord {
    pub workspace_id: String,
    pub memory_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub embedding_version: String,
    pub dimensions: usize,
    pub content_hash: String,
    pub vector: Vec<f32>,
    pub memory_updated_at: i64,
    pub indexed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct EmbedIndexFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    records: Vec<EmbedIndexRecord>,
}

fn index_path(ws_dir: &std::path::Path) -> PathBuf {
    ws_dir.join(INDEX_FILE_NAME)
}

fn read_index_file(path: &std::path::Path) -> Result<EmbedIndexFile, String> {
    if !path.exists() {
        return Ok(EmbedIndexFile {
            version: 1,
            records: Vec::new(),
        });
    }
    let raw = match std::fs::read_to_string(path) {
        Ok(r) => r,
        Err(e) => return Err(e.to_string()),
    };
    if raw.trim().is_empty() {
        return Ok(EmbedIndexFile {
            version: 1,
            records: Vec::new(),
        });
    }
    match serde_json::from_str(&raw) {
        Ok(file) => Ok(file),
        Err(e) => {
            // 损坏文件 → 备份，不阻塞下次读写
            let bak = path.with_extension("json.bak");
            let _ = std::fs::rename(path, &bak);
            log::warn!(
                "[embed_index] corrupted index file, backed up to {}: {}",
                bak.display(),
                e
            );
            Ok(EmbedIndexFile {
                version: 1,
                records: Vec::new(),
            })
        }
    }
}

fn write_index_file(path: &std::path::Path, file: &EmbedIndexFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn project_memory_embed_index_list(
    workspace_id: String,
) -> Result<Vec<EmbedIndexRecord>, String> {
    run_project_memory_io(move || {
        let ws_dir = match resolve_workspace_dir(&workspace_id)? {
            Some(dir) => dir,
            None => return Ok(Vec::new()),
        };
        let file = read_index_file(&index_path(&ws_dir))?;
        Ok(file.records)
    })
    .await
}

#[tauri::command]
pub(crate) async fn project_memory_embed_index_upsert(
    workspace_id: String,
    records: Vec<EmbedIndexRecord>,
) -> Result<(), String> {
    run_project_memory_io(move || {
        let ws_dir = match resolve_workspace_dir(&workspace_id)? {
            Some(dir) => dir,
            None => return Err("workspace_dir_not_found".to_string()),
        };
        let path = index_path(&ws_dir);
        let mut file = read_index_file(&path)?;
        file.version = 1;
        for incoming in records {
            if let Some(existing) = file
                .records
                .iter_mut()
                .find(|r| r.memory_id == incoming.memory_id)
            {
                *existing = incoming;
            } else {
                file.records.push(incoming);
            }
        }
        write_index_file(&path, &file)
    })
    .await
}

#[tauri::command]
pub(crate) async fn project_memory_embed_index_delete(
    workspace_id: String,
    memory_ids: Vec<String>,
) -> Result<(), String> {
    run_project_memory_io(move || {
        let ws_dir = match resolve_workspace_dir(&workspace_id)? {
            Some(dir) => dir,
            None => return Ok(()),
        };
        let path = index_path(&ws_dir);
        let mut file = read_index_file(&path)?;
        if memory_ids.is_empty() {
            return Ok(());
        }
        let id_set: std::collections::HashSet<&str> =
            memory_ids.iter().map(|s| s.as_str()).collect();
        file.records
            .retain(|r| !id_set.contains(r.memory_id.as_str()));
        write_index_file(&path, &file)
    })
    .await
}

#[tauri::command]
pub(crate) async fn project_memory_embed_index_clear(workspace_id: String) -> Result<(), String> {
    run_project_memory_io(move || {
        let ws_dir = match resolve_workspace_dir(&workspace_id)? {
            Some(dir) => dir,
            None => return Ok(()),
        };
        let path = index_path(&ws_dir);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}
