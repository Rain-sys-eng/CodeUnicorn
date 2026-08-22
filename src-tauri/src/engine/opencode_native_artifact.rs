use serde_json::{json, Value};
use std::ops::{Deref, DerefMut};
use tokio::process::Command;

#[cfg(any(windows, test))]
use std::fs::File;
#[cfg(any(windows, test))]
use std::fs::{self, OpenOptions};
#[cfg(any(windows, test))]
use std::io::Write;
#[cfg(any(windows, test))]
use std::path::{Path, PathBuf};

#[cfg(windows)]
const OPENCODE_BUN_TMP_ROOT_DIR: &str = "opencode-bun-tmp";
#[cfg(any(windows, test))]
const ROOT_MARKER_FILENAME: &str = ".ccgui-opencode-bun-root";
#[cfg(any(windows, test))]
const RUN_MARKER_FILENAME: &str = ".ccgui-opencode-bun-run";
#[cfg(any(windows, test))]
const RUN_LOCK_FILENAME: &str = ".ccgui-owner.lock";
#[cfg(any(windows, test))]
const OWNERSHIP_MARKER: &str = "ccgui-opencode-bun-native-artifact-v1";
#[cfg(any(windows, test))]
const RUN_DIR_PREFIX: &str = "run-";

#[cfg(windows)]
pub(crate) const OPENCODE_BUN_TMP_RUN_LIMIT_BYTES: u64 = 256 * 1024 * 1024;
#[cfg(windows)]
pub(crate) const OPENCODE_BUN_TMP_ROOT_LIMIT_BYTES: u64 = 512 * 1024 * 1024;

#[cfg(any(windows, test))]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct ArtifactUsage {
    files: u64,
    bytes: u64,
}

#[cfg(any(windows, test))]
impl ArtifactUsage {
    fn saturating_add_assign(&mut self, other: Self) {
        self.files = self.files.saturating_add(other.files);
        self.bytes = self.bytes.saturating_add(other.bytes);
    }
}

/// Owns the Windows-only temporary directory lease for one OpenCode child.
///
/// The empty form is intentional on macOS/Linux: those platforms preserve the
/// inherited environment and perform no filesystem work for this feature.
pub(crate) struct OpenCodeNativeArtifactLease {
    #[cfg(any(windows, test))]
    root: Option<PathBuf>,
    #[cfg(any(windows, test))]
    run_dir: Option<PathBuf>,
    #[cfg(any(windows, test))]
    lock_file: Option<File>,
}

/// Couples an OpenCode command with its temporary-artifact lease.
///
/// Command-only paths such as `session list` and `mcp list` do not need a
/// process registry, but their lease still must survive until `.output()` or
/// `.spawn()` completes. `DerefMut` keeps the existing command construction
/// call sites small while making that lifetime explicit in the type.
pub(crate) struct ContainedOpenCodeCommand {
    command: Command,
    _native_artifact_lease: OpenCodeNativeArtifactLease,
}

#[derive(Debug, Clone)]
pub(crate) struct OpenCodeNativeArtifactMonitor {
    #[cfg(any(windows, test))]
    root: Option<PathBuf>,
    #[cfg(any(windows, test))]
    run_dir: Option<PathBuf>,
}

impl OpenCodeNativeArtifactLease {
    pub(crate) fn prepare(command: &mut Command) -> Result<Self, String> {
        #[cfg(windows)]
        {
            let root = opencode_bun_tmp_root()?;
            ensure_owned_root(&root)?;
            cleanup_stale_owned_runs(&root)?;
            enforce_root_limit(&root, OPENCODE_BUN_TMP_ROOT_LIMIT_BYTES)?;

            let lease = create_windows_lease_at(&root)?;
            let run_dir = lease
                .run_dir
                .as_deref()
                .ok_or_else(|| "OpenCode private Bun temp directory is unavailable".to_string())?;
            command.env("BUN_TMPDIR", run_dir);
            Ok(lease)
        }

        #[cfg(all(not(windows), test))]
        {
            let _ = command;
            Ok(Self {
                root: None,
                run_dir: None,
                lock_file: None,
            })
        }

        #[cfg(all(not(windows), not(test)))]
        {
            let _ = command;
            Ok(Self {})
        }
    }

    pub(crate) fn monitor(&self) -> OpenCodeNativeArtifactMonitor {
        #[cfg(any(windows, test))]
        {
            return OpenCodeNativeArtifactMonitor {
                root: self.root.clone(),
                run_dir: self.run_dir.clone(),
            };
        }

        #[cfg(not(any(windows, test)))]
        OpenCodeNativeArtifactMonitor {}
    }

    #[cfg(test)]
    fn is_active(&self) -> bool {
        self.root.is_some() && self.run_dir.is_some() && self.lock_file.is_some()
    }
}

impl ContainedOpenCodeCommand {
    pub(crate) fn new(mut command: Command) -> Result<Self, String> {
        let native_artifact_lease = OpenCodeNativeArtifactLease::prepare(&mut command)?;
        Ok(Self {
            command,
            _native_artifact_lease: native_artifact_lease,
        })
    }
}

impl Deref for ContainedOpenCodeCommand {
    type Target = Command;

    fn deref(&self) -> &Self::Target {
        &self.command
    }
}

impl DerefMut for ContainedOpenCodeCommand {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.command
    }
}

impl Drop for OpenCodeNativeArtifactLease {
    fn drop(&mut self) {
        #[cfg(any(windows, test))]
        {
            let Some(root) = self.root.as_deref() else {
                return;
            };
            let Some(run_dir) = self.run_dir.as_deref() else {
                return;
            };

            release_lock(self.lock_file.take());
            if let Err(error) = remove_owned_run_directory(root, run_dir) {
                log::warn!(
                    "[opencode] deferred cleanup of private Bun artifact directory failed: {error}"
                );
            }
        }
    }
}

impl OpenCodeNativeArtifactMonitor {
    pub(crate) fn enforce_budget(&self) -> Result<(), String> {
        #[cfg(windows)]
        {
            let (Some(root), Some(run_dir)) = (self.root.as_deref(), self.run_dir.as_deref())
            else {
                return Ok(());
            };
            if !run_dir.exists() {
                return Ok(());
            }
            enforce_budgets(
                root,
                run_dir,
                OPENCODE_BUN_TMP_RUN_LIMIT_BYTES,
                OPENCODE_BUN_TMP_ROOT_LIMIT_BYTES,
            )
        }

        #[cfg(not(windows))]
        {
            Ok(())
        }
    }
}

pub(crate) fn runtime_diagnostics() -> Value {
    #[cfg(windows)]
    {
        let usage = opencode_bun_tmp_root().and_then(|root| {
            if root.exists() {
                ensure_owned_root(&root)?;
                owned_root_usage(&root)
            } else {
                Ok(ArtifactUsage::default())
            }
        });
        match usage {
            Ok(usage) => json!({
                "policy": "windows-private-bun-tmpdir",
                "enabled": true,
                "artifactFiles": usage.files,
                "artifactBytes": usage.bytes,
                "perRunLimitBytes": OPENCODE_BUN_TMP_RUN_LIMIT_BYTES,
                "rootLimitBytes": OPENCODE_BUN_TMP_ROOT_LIMIT_BYTES,
                "cleanupScope": "ccgui-owned-run-directories-only",
                "runtimeProvenance": "unverified",
                "upgradeRecommendation": "Update opencode-ai to an upstream release built with Bun 1.4.0 or later."
            }),
            Err(error) => json!({
                "policy": "windows-private-bun-tmpdir",
                "enabled": false,
                "cleanupScope": "ccgui-owned-run-directories-only",
                "runtimeProvenance": "unverified",
                "error": error,
                "upgradeRecommendation": "Update opencode-ai to an upstream release built with Bun 1.4.0 or later."
            }),
        }
    }

    #[cfg(not(windows))]
    {
        json!({
            "policy": "inherit-environment",
            "enabled": false,
            "cleanupScope": "none",
            "platformEvidence": "unverified",
            "runtimeProvenance": "unverified"
        })
    }
}

#[cfg(windows)]
fn opencode_bun_tmp_root() -> Result<PathBuf, String> {
    Ok(crate::app_paths::app_home_dir()?
        .join("runtime")
        .join(OPENCODE_BUN_TMP_ROOT_DIR))
}

#[cfg(any(windows, test))]
fn ensure_owned_root(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("failed to prepare OpenCode artifact root: {error}"))?;
    let metadata = fs::symlink_metadata(root)
        .map_err(|error| format!("failed to inspect OpenCode artifact root: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("OpenCode artifact root is not a safe directory".to_string());
    }
    ensure_marker(&root.join(ROOT_MARKER_FILENAME))
}

#[cfg(any(windows, test))]
fn ensure_marker(marker_path: &Path) -> Result<(), String> {
    match fs::read_to_string(marker_path) {
        Ok(value) if value.trim() == OWNERSHIP_MARKER => return Ok(()),
        Ok(_) => return Err("OpenCode artifact ownership marker does not match".to_string()),
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            return Err(format!(
                "failed to read OpenCode artifact ownership marker: {error}"
            ));
        }
        Err(_) => {}
    }

    let mut marker = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(marker_path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let value = fs::read_to_string(marker_path).map_err(|read_error| {
                format!("failed to read OpenCode artifact ownership marker: {read_error}")
            })?;
            return if value.trim() == OWNERSHIP_MARKER {
                Ok(())
            } else {
                Err("OpenCode artifact ownership marker does not match".to_string())
            };
        }
        Err(error) => {
            return Err(format!(
                "failed to create OpenCode artifact ownership marker: {error}"
            ));
        }
    };
    marker
        .write_all(OWNERSHIP_MARKER.as_bytes())
        .map_err(|error| format!("failed to write OpenCode artifact ownership marker: {error}"))?;
    marker
        .sync_all()
        .map_err(|error| format!("failed to sync OpenCode artifact ownership marker: {error}"))
}

#[cfg(any(windows, test))]
fn create_windows_lease_at(root: &Path) -> Result<OpenCodeNativeArtifactLease, String> {
    for _ in 0..3 {
        let run_dir = root.join(format!("{RUN_DIR_PREFIX}{}", uuid::Uuid::new_v4()));
        match fs::create_dir(&run_dir) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "failed to create OpenCode private Bun temp directory: {error}"
                ));
            }
        }

        if let Err(error) = ensure_marker(&run_dir.join(RUN_MARKER_FILENAME)) {
            let _ = fs::remove_dir_all(&run_dir);
            return Err(error);
        }
        let lock_file = match OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(run_dir.join(RUN_LOCK_FILENAME))
        {
            Ok(file) => file,
            Err(error) => {
                let _ = fs::remove_dir_all(&run_dir);
                return Err(format!(
                    "failed to create OpenCode private Bun temp lock: {error}"
                ));
            }
        };
        if let Err(error) = lock_file.try_lock() {
            let _ = fs::remove_dir_all(&run_dir);
            return Err(format!(
                "failed to lock OpenCode private Bun temp directory: {error}"
            ));
        }
        return Ok(OpenCodeNativeArtifactLease {
            root: Some(root.to_path_buf()),
            run_dir: Some(run_dir),
            lock_file: Some(lock_file),
        });
    }
    Err("failed to allocate a unique OpenCode private Bun temp directory".to_string())
}

#[cfg(any(windows, test))]
fn cleanup_stale_owned_runs(root: &Path) -> Result<(), String> {
    let entries = fs::read_dir(root)
        .map_err(|error| format!("failed to inspect OpenCode artifact root: {error}"))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("failed to inspect OpenCode artifact entry: {error}"))?;
        let candidate = entry.path();
        if validate_owned_run_directory(root, &candidate).is_err() {
            continue;
        }

        let lock_path = candidate.join(RUN_LOCK_FILENAME);
        let lock_file = match OpenOptions::new().read(true).write(true).open(&lock_path) {
            Ok(file) => file,
            Err(error) => {
                log::warn!(
                    "[opencode] stale Bun artifact cleanup skipped an unreadable lease: {error}"
                );
                continue;
            }
        };
        if lock_file.try_lock().is_err() {
            continue;
        }
        release_lock(Some(lock_file));
        if let Err(error) = remove_owned_run_directory(root, &candidate) {
            log::warn!("[opencode] stale Bun artifact cleanup skipped a lease: {error}");
        }
    }
    Ok(())
}

#[cfg(any(windows, test))]
fn release_lock(lock_file: Option<File>) {
    if let Some(lock_file) = lock_file {
        let _ = lock_file.unlock();
    }
}

#[cfg(any(windows, test))]
fn remove_owned_run_directory(root: &Path, run_dir: &Path) -> Result<(), String> {
    if !run_dir.exists() {
        return Ok(());
    }
    validate_owned_run_directory(root, run_dir)?;
    fs::remove_dir_all(run_dir)
        .map_err(|error| format!("failed to remove owned OpenCode Bun artifact directory: {error}"))
}

#[cfg(any(windows, test))]
fn validate_owned_run_directory(root: &Path, run_dir: &Path) -> Result<(), String> {
    if run_dir.parent() != Some(root) {
        return Err("OpenCode artifact cleanup target is not a direct child".to_string());
    }
    let name = run_dir
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "OpenCode artifact cleanup target has an invalid name".to_string())?;
    if !name.starts_with(RUN_DIR_PREFIX) {
        return Err("OpenCode artifact cleanup target has an invalid prefix".to_string());
    }
    let metadata = fs::symlink_metadata(run_dir)
        .map_err(|error| format!("failed to inspect OpenCode artifact cleanup target: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("OpenCode artifact cleanup target is not a safe directory".to_string());
    }
    let marker = fs::read_to_string(run_dir.join(RUN_MARKER_FILENAME))
        .map_err(|error| format!("failed to read OpenCode artifact ownership marker: {error}"))?;
    if marker.trim() != OWNERSHIP_MARKER {
        return Err("OpenCode artifact ownership marker does not match".to_string());
    }
    Ok(())
}

#[cfg(windows)]
fn enforce_root_limit(root: &Path, root_limit_bytes: u64) -> Result<(), String> {
    let usage = owned_root_usage(root)?;
    if usage.bytes > root_limit_bytes {
        return Err(storage_limit_error(
            usage.bytes,
            usage.bytes,
            OPENCODE_BUN_TMP_RUN_LIMIT_BYTES,
            root_limit_bytes,
        ));
    }
    Ok(())
}

#[cfg(any(windows, test))]
fn enforce_budgets(
    root: &Path,
    run_dir: &Path,
    run_limit_bytes: u64,
    root_limit_bytes: u64,
) -> Result<(), String> {
    let run_usage = artifact_usage(run_dir)?;
    let root_usage = owned_root_usage(root)?;
    if run_usage.bytes > run_limit_bytes || root_usage.bytes > root_limit_bytes {
        return Err(storage_limit_error(
            run_usage.bytes,
            root_usage.bytes,
            run_limit_bytes,
            root_limit_bytes,
        ));
    }
    Ok(())
}

#[cfg(any(windows, test))]
fn storage_limit_error(
    run_bytes: u64,
    root_bytes: u64,
    run_limit_bytes: u64,
    root_limit_bytes: u64,
) -> String {
    format!(
        "OpenCode stopped because private Bun temporary artifacts exceeded the storage limit (run={run_bytes} bytes, root={root_bytes} bytes; limits={run_limit_bytes}/{root_limit_bytes} bytes). Update opencode-ai to an upstream release built with Bun 1.4.0 or later."
    )
}

#[cfg(any(windows, test))]
fn owned_root_usage(root: &Path) -> Result<ArtifactUsage, String> {
    let mut usage = ArtifactUsage::default();
    let entries = fs::read_dir(root)
        .map_err(|error| format!("failed to inspect OpenCode artifact root usage: {error}"))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("failed to inspect OpenCode artifact entry: {error}"))?;
        let candidate = entry.path();
        if validate_owned_run_directory(root, &candidate).is_ok() {
            usage.saturating_add_assign(artifact_usage(&candidate)?);
        }
    }
    Ok(usage)
}

#[cfg(any(windows, test))]
fn artifact_usage(directory: &Path) -> Result<ArtifactUsage, String> {
    let mut usage = ArtifactUsage::default();
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("failed to inspect OpenCode artifact directory: {error}"))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("failed to inspect OpenCode artifact file: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("failed to inspect OpenCode artifact metadata: {error}"))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            usage.saturating_add_assign(artifact_usage(&path)?);
            continue;
        }
        if metadata.is_file() && !is_lease_metadata_file(&path) {
            usage.files = usage.files.saturating_add(1);
            usage.bytes = usage.bytes.saturating_add(metadata.len());
        }
    }
    Ok(usage)
}

#[cfg(any(windows, test))]
fn is_lease_metadata_file(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(RUN_MARKER_FILENAME | RUN_LOCK_FILENAME)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "ccgui-opencode-native-artifact-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn create_unlocked_owned_run(root: &Path) -> PathBuf {
        ensure_owned_root(root).expect("prepare root");
        let run_dir = root.join(format!("{RUN_DIR_PREFIX}{}", uuid::Uuid::new_v4()));
        fs::create_dir(&run_dir).expect("create run directory");
        ensure_marker(&run_dir.join(RUN_MARKER_FILENAME)).expect("write run marker");
        fs::write(run_dir.join(RUN_LOCK_FILENAME), "").expect("write lock file");
        run_dir
    }

    #[test]
    fn lease_uses_a_private_marked_run_directory_and_cleans_it_on_drop() {
        let root = test_root("lease");
        ensure_owned_root(&root).expect("prepare root");
        let lease = create_windows_lease_at(&root).expect("create lease");
        let run_dir = lease.monitor().run_dir.expect("active lease run directory");

        assert!(run_dir.starts_with(&root));
        assert!(run_dir.join(RUN_MARKER_FILENAME).exists());
        assert!(lease.is_active());

        drop(lease);
        assert!(!run_dir.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stale_cleanup_reclaims_only_unlocked_owned_runs() {
        let root = test_root("stale");
        let stale_run = create_unlocked_owned_run(&root);
        let active_lease = create_windows_lease_at(&root).expect("create active lease");
        let active_run = active_lease
            .monitor()
            .run_dir
            .expect("active run directory");

        cleanup_stale_owned_runs(&root).expect("clean stale runs");

        assert!(!stale_run.exists());
        assert!(active_run.exists());
        drop(active_lease);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stale_cleanup_skips_unmarked_candidates() {
        let root = test_root("unmarked");
        ensure_owned_root(&root).expect("prepare root");
        let unmarked = root.join(format!("{RUN_DIR_PREFIX}{}", uuid::Uuid::new_v4()));
        fs::create_dir(&unmarked).expect("create unmarked directory");

        cleanup_stale_owned_runs(&root).expect("clean stale runs");

        assert!(unmarked.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn storage_budget_reports_limit_without_reading_file_contents() {
        let root = test_root("budget");
        let run_dir = create_unlocked_owned_run(&root);
        fs::write(run_dir.join(".artifact.node"), [1_u8, 2_u8]).expect("write artifact");

        let error = enforce_budgets(&root, &run_dir, 1, 16).expect_err("budget must fail");

        assert!(error.contains("storage limit"));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn stale_cleanup_skips_symlink_candidates() {
        use std::os::unix::fs::symlink;

        let root = test_root("symlink");
        let target = test_root("symlink-target");
        ensure_owned_root(&root).expect("prepare root");
        fs::create_dir_all(&target).expect("create target");
        ensure_marker(&target.join(RUN_MARKER_FILENAME)).expect("write target marker");
        fs::write(target.join(RUN_LOCK_FILENAME), "").expect("write target lock");
        let candidate = root.join(format!("{RUN_DIR_PREFIX}{}", uuid::Uuid::new_v4()));
        symlink(&target, &candidate).expect("create candidate symlink");

        cleanup_stale_owned_runs(&root).expect("clean stale runs");

        assert!(candidate.exists());
        assert!(target.exists());
        let _ = fs::remove_file(candidate);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(target);
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_policy_keeps_the_environment_unchanged() {
        let mut command = Command::new("opencode");
        let lease =
            OpenCodeNativeArtifactLease::prepare(&mut command).expect("prepare no-op lease");

        assert!(!lease.is_active());
        assert!(lease.monitor().root.is_none());
        assert!(lease.monitor().run_dir.is_none());
    }
}
