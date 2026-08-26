//! 自定义命令目录的文件系统监听。
//!
//! 监听的目录集合与 `claude_commands::resolve_commands_dirs` 完全一致，
//! 任何命令 `.md` 的新增/修改/删除在去抖后向前端 emit
//! `claude-commands-changed`，由前端刷新命令补全，替代秒级轮询。

use notify::{Config as NotifyConfig, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::state::AppState;

pub(crate) const CLAUDE_COMMANDS_CHANGED_EVENT: &str = "claude-commands-changed";

/// 去抖窗口：编辑器原子写入（write+rename）与批量改动合并为一次刷新。
const WATCH_DEBOUNCE: Duration = Duration::from_millis(500);

#[derive(Default)]
pub(crate) struct CommandsWatchRegistry {
    watches: HashMap<String, CommandsWatchLease>,
}

struct CommandsWatchLease {
    handle: JoinHandle<()>,
    leases: usize,
}

impl CommandsWatchRegistry {
    fn acquire(&mut self, scope_key: &str) -> bool {
        let Some(watch) = self.watches.get_mut(scope_key) else {
            return false;
        };
        watch.leases = watch.leases.saturating_add(1);
        true
    }

    fn insert(&mut self, scope_key: String, handle: JoinHandle<()>) {
        debug_assert!(!self.watches.contains_key(&scope_key));
        self.watches
            .insert(scope_key, CommandsWatchLease { handle, leases: 1 });
    }

    fn release(&mut self, scope_key: &str) {
        let should_remove = match self.watches.get_mut(scope_key) {
            Some(watch) if watch.leases > 1 => {
                watch.leases -= 1;
                false
            }
            Some(_) => true,
            None => false,
        };
        if should_remove {
            if let Some(watch) = self.watches.remove(scope_key) {
                watch.handle.abort();
            }
        }
    }

    #[cfg(test)]
    fn lease_count(&self, scope_key: &str) -> usize {
        self.watches
            .get(scope_key)
            .map(|watch| watch.leases)
            .unwrap_or(0)
    }
}

fn watch_scope_key(workspace_id: Option<&str>) -> String {
    workspace_id
        .map(|value| value.to_string())
        .unwrap_or_else(|| "global".to_string())
}

/// 编辑器保存常伴随 chmod/元数据变更；仅内容/结构类事件需要触发刷新。
fn is_relevant_commands_event(event: &Event) -> bool {
    match event.kind {
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Any => {}
        EventKind::Modify(kind) => {
            use notify::event::ModifyKind;
            match kind {
                ModifyKind::Data(_) | ModifyKind::Name(_) | ModifyKind::Any => {}
                _ => return false,
            }
        }
        _ => return false,
    }
    event.paths.iter().any(|path| {
        let is_markdown = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        // 目录事件（如 commands/ 被创建）没有扩展名，也需要纳入，
        // 以便 flush 时补挂新目录的递归监听。
        let looks_like_dir = path.extension().is_none();
        is_markdown || looks_like_dir
    })
}

/// 计算当前应监听的路径：存在的命令目录递归监听；目录尚不存在时
/// 退化为监听其父目录（非递归），以便捕获目录创建事件。
fn resolve_watch_targets(candidates: &[PathBuf]) -> Vec<(PathBuf, RecursiveMode)> {
    let mut targets: Vec<(PathBuf, RecursiveMode)> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for candidate in candidates {
        let (path, mode) = if candidate.is_dir() {
            (candidate.clone(), RecursiveMode::Recursive)
        } else {
            match candidate.parent() {
                Some(parent) if parent.is_dir() => {
                    (parent.to_path_buf(), RecursiveMode::NonRecursive)
                }
                _ => continue,
            }
        };
        if seen.insert(path.clone()) {
            targets.push((path, mode));
        }
    }
    targets
}

fn sync_watch_targets(
    watcher: &mut RecommendedWatcher,
    watched: &mut HashSet<PathBuf>,
    candidates: &[PathBuf],
) {
    for (path, mode) in resolve_watch_targets(candidates) {
        if !watched.insert(path.clone()) {
            continue;
        }
        if let Err(error) = watcher.watch(&path, mode) {
            log::warn!(
                "claude_commands_watch failed to watch {}: {}",
                path.display(),
                error
            );
            watched.remove(&path);
        }
    }
}

async fn run_commands_watcher(
    app: AppHandle,
    workspace_id: Option<String>,
    mut watcher: RecommendedWatcher,
    mut event_rx: mpsc::UnboundedReceiver<notify::Result<Event>>,
    mut watched: HashSet<PathBuf>,
) {
    while let Some(result) = event_rx.recv().await {
        let relevant = matches!(result, Ok(ref event) if is_relevant_commands_event(event));
        if !relevant {
            continue;
        }

        // 去抖：持续有新事件则顺延，静默满 WATCH_DEBOUNCE 后 flush。
        let mut deadline = Instant::now() + WATCH_DEBOUNCE;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, event_rx.recv()).await {
                Ok(Some(Ok(event))) => {
                    if is_relevant_commands_event(&event) {
                        deadline = Instant::now() + WATCH_DEBOUNCE;
                    }
                }
                Ok(Some(Err(_))) => {}
                Ok(None) => return,
                Err(_) => break,
            }
        }

        // flush：先补挂新出现的命令目录，再通知前端刷新。
        let state = app.state::<AppState>();
        let candidates: Vec<PathBuf> =
            crate::claude_commands::resolve_commands_dirs(&state, workspace_id.as_deref())
                .await
                .into_iter()
                .map(|(dir, _)| dir)
                .collect();
        sync_watch_targets(&mut watcher, &mut watched, &candidates);

        if let Err(error) = app.emit(CLAUDE_COMMANDS_CHANGED_EVENT, ()) {
            log::warn!(
                "claude_commands_watch failed to emit {}: {}",
                CLAUDE_COMMANDS_CHANGED_EVENT,
                error
            );
        }
    }
}

#[tauri::command]
pub(crate) async fn claude_commands_watch_start(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: Option<String>,
) -> Result<(), String> {
    let scope_key = watch_scope_key(workspace_id.as_deref());
    let mut registry = state.claude_commands_watches.lock().await;
    if registry.acquire(&scope_key) {
        return Ok(());
    }

    let candidates: Vec<PathBuf> =
        crate::claude_commands::resolve_commands_dirs(&state, workspace_id.as_deref())
            .await
            .into_iter()
            .map(|(dir, _)| dir)
            .collect();

    let (event_tx, event_rx) = mpsc::unbounded_channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(
        move |result| {
            let _ = event_tx.send(result);
        },
        NotifyConfig::default(),
    )
    .map_err(|error| format!("failed to initialize commands watcher: {error}"))?;

    let mut watched: HashSet<PathBuf> = HashSet::new();
    sync_watch_targets(&mut watcher, &mut watched, &candidates);

    let join = tokio::spawn(run_commands_watcher(
        app,
        workspace_id,
        watcher,
        event_rx,
        watched,
    ));

    registry.insert(scope_key, join);
    Ok(())
}

#[tauri::command]
pub(crate) async fn claude_commands_watch_stop(
    state: State<'_, AppState>,
    workspace_id: Option<String>,
) -> Result<(), String> {
    let scope_key = watch_scope_key(workspace_id.as_deref());
    let mut registry = state.claude_commands_watches.lock().await;
    registry.release(&scope_key);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind, RenameMode};
    use std::fs;

    fn event_with_paths(kind: EventKind, paths: Vec<PathBuf>) -> Event {
        Event {
            kind,
            paths,
            attrs: Default::default(),
        }
    }

    #[test]
    fn relevant_for_markdown_create_modify_remove() {
        let md = PathBuf::from("/repo/.claude/commands/deploy.md");
        assert!(is_relevant_commands_event(&event_with_paths(
            EventKind::Create(CreateKind::File),
            vec![md.clone()],
        )));
        assert!(is_relevant_commands_event(&event_with_paths(
            EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            vec![md.clone()],
        )));
        assert!(is_relevant_commands_event(&event_with_paths(
            EventKind::Modify(ModifyKind::Name(RenameMode::To)),
            vec![md],
        )));
    }

    #[test]
    fn relevant_for_directory_events_without_extension() {
        let dir = PathBuf::from("/repo/.claude/commands");
        assert!(is_relevant_commands_event(&event_with_paths(
            EventKind::Create(CreateKind::Folder),
            vec![dir],
        )));
    }

    #[test]
    fn ignores_non_markdown_files_and_metadata_only_changes() {
        let txt = PathBuf::from("/repo/.claude/commands/notes.txt");
        assert!(!is_relevant_commands_event(&event_with_paths(
            EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            vec![txt],
        )));
        let md = PathBuf::from("/repo/.claude/commands/deploy.md");
        assert!(!is_relevant_commands_event(&event_with_paths(
            EventKind::Modify(ModifyKind::Metadata(notify::event::MetadataKind::Any)),
            vec![md],
        )));
    }

    #[test]
    fn watch_targets_recurse_existing_dirs_and_fall_back_to_parent() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ccgui-commands-watch-{nonce}"));
        let existing = root.join("commands");
        fs::create_dir_all(&existing).expect("create existing commands dir");
        // 父目录存在但 commands/ 尚未创建：应退化为监听父目录。
        fs::create_dir_all(root.join("missing")).expect("create missing parent");
        let missing = root.join("missing").join("commands");

        let targets = resolve_watch_targets(&[existing.clone(), missing]);
        assert_eq!(
            targets,
            vec![
                (existing, RecursiveMode::Recursive),
                (root.join("missing"), RecursiveMode::NonRecursive),
            ]
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn watch_targets_skip_candidates_without_existing_parent() {
        let missing = PathBuf::from("/definitely/not/existing/commands");
        let targets = resolve_watch_targets(&[missing]);
        assert!(targets.is_empty());
    }

    #[test]
    fn scope_key_defaults_to_global() {
        assert_eq!(watch_scope_key(None), "global");
        assert_eq!(watch_scope_key(Some("ws-1")), "ws-1");
    }

    #[tokio::test]
    async fn registry_releases_duplicate_scope_only_after_last_lease() {
        let mut registry = CommandsWatchRegistry::default();
        registry.insert(
            "ws-1".to_string(),
            tokio::spawn(std::future::pending::<()>()),
        );
        assert!(registry.acquire("ws-1"));
        assert_eq!(registry.lease_count("ws-1"), 2);

        registry.release("ws-1");
        assert_eq!(registry.lease_count("ws-1"), 1);

        registry.release("ws-1");
        assert_eq!(registry.lease_count("ws-1"), 0);
    }
}
