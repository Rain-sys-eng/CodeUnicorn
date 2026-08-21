//! Global DSH host supervisor: probe → adopt, else spawn. Kill only spawned.

use super::host::{origin_from_host_port, DshHostClient};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

// Windows Defender + npm plugin-tree boot is slower. Mac shebang spawn was
// already healthy at 20s; do not stretch the Unix wait just because Win needs it.
#[cfg(windows)]
const SPAWN_READY_TIMEOUT: Duration = Duration::from_secs(45);
#[cfg(not(windows))]
const SPAWN_READY_TIMEOUT: Duration = Duration::from_secs(20);
const SPAWN_POLL: Duration = Duration::from_millis(250);
const SPAWN_LOG_LIMIT: usize = 8 * 1024;

#[derive(Debug, Clone)]
pub struct DshRuntimeSettings {
    pub bin_path: Option<String>,
    pub host: String,
    pub port: u16,
    pub auto_start: bool,
}

impl Default for DshRuntimeSettings {
    fn default() -> Self {
        Self {
            bin_path: None,
            host: "127.0.0.1".to_string(),
            port: 3080,
            auto_start: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DshHostOwnership {
    Adopted,
    Spawned,
}

#[derive(Debug, Clone)]
pub struct DshHostSnapshot {
    pub origin: String,
    pub host: String,
    pub port: u16,
    pub ownership: DshHostOwnership,
    pub describe: serde_json::Value,
}

struct LiveHost {
    snapshot: DshHostSnapshot,
    child: Option<Child>,
}

struct SupervisorState {
    live: Option<LiveHost>,
    pending_child: Option<Child>,
    pending_logs: Arc<std::sync::Mutex<String>>,
    spawn_generation: u64,
}

static SUPERVISOR: OnceLock<Mutex<SupervisorState>> = OnceLock::new();
static REMEMBERED_ENDPOINT: OnceLock<std::sync::Mutex<Option<(String, u16)>>> = OnceLock::new();

fn remembered_endpoint_slot() -> &'static std::sync::Mutex<Option<(String, u16)>> {
    REMEMBERED_ENDPOINT.get_or_init(|| std::sync::Mutex::new(None))
}

pub fn remember_endpoint(host: &str, port: u16) {
    if let Ok(mut slot) = remembered_endpoint_slot().lock() {
        *slot = Some((host.to_string(), port));
    }
}

pub fn remembered_endpoint() -> Option<(String, u16)> {
    remembered_endpoint_slot()
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
}

fn state() -> &'static Mutex<SupervisorState> {
    SUPERVISOR.get_or_init(|| {
        Mutex::new(SupervisorState {
            live: None,
            pending_child: None,
            pending_logs: Arc::new(std::sync::Mutex::new(String::new())),
            spawn_generation: 0,
        })
    })
}

pub async fn current_snapshot() -> Option<DshHostSnapshot> {
    let guard = state().lock().await;
    guard.live.as_ref().map(|live| live.snapshot.clone())
}

pub async fn ensure_host(settings: &DshRuntimeSettings) -> Result<DshHostSnapshot, String> {
    remember_endpoint(&settings.host, settings.port);
    let wanted_origin = origin_from_host_port(&settings.host, settings.port);
    let spawn_generation = {
        let mut guard = state().lock().await;
        if let Some(live) = guard.live.as_ref() {
            let live_origin = live.snapshot.origin.clone();
            let live_snapshot = live.snapshot.clone();
            if live_origin == wanted_origin && probe_describe(&live_origin).await.is_ok() {
                return Ok(live_snapshot);
            }
            // Host/port changed or the live process died. Kill only a spawned
            // child that no longer matches the requested origin.
            drop_unlocked(&mut guard, live_origin != wanted_origin).await;
        }

        let origin = wanted_origin.clone();
        if let Ok(describe) = probe_describe(&origin).await {
            let snapshot = DshHostSnapshot {
                origin,
                host: settings.host.clone(),
                port: settings.port,
                ownership: DshHostOwnership::Adopted,
                describe,
            };
            guard.live = Some(LiveHost {
                snapshot: snapshot.clone(),
                child: None,
            });
            log::info!(
                "[dsh] adopted host {} (do not kill on mossx exit)",
                snapshot.origin
            );
            return Ok(snapshot);
        }

        if !settings.auto_start {
            return Err(format!(
                "DSH host is not running at {origin}. Start `dsh web` or enable auto-start."
            ));
        }

        let bin = resolve_dsh_bin(settings.bin_path.as_deref())?;
        let spawned = spawn_dsh_web(&bin, &settings.host, settings.port)?;
        if let Some(previous) = guard.pending_child.take() {
            let _ = kill_child(previous).await;
        }
        guard.spawn_generation = guard.spawn_generation.wrapping_add(1);
        let generation = guard.spawn_generation;
        guard.pending_child = Some(spawned.child);
        guard.pending_logs = spawned.logs;
        generation
    };

    let origin = wanted_origin;
    let wait_result = wait_until_ready(&origin, spawn_generation).await;
    let mut guard = state().lock().await;
    let cancelled = guard.spawn_generation != spawn_generation;
    let pending = guard.pending_child.take();
    if cancelled {
        if let Some(child) = pending {
            let _ = kill_child(child).await;
        }
        return Err("DSH host start was cancelled.".to_string());
    }

    match wait_result {
        Ok(describe) => {
            let snapshot = DshHostSnapshot {
                origin,
                host: settings.host.clone(),
                port: settings.port,
                ownership: DshHostOwnership::Spawned,
                describe,
            };
            guard.live = Some(LiveHost {
                snapshot: snapshot.clone(),
                child: pending,
            });
            log::info!("[dsh] spawned host {}", snapshot.origin);
            Ok(snapshot)
        }
        Err(spawn_err) => {
            // Port may have been claimed by the user's own host while we spawned.
            if let Ok(describe) = probe_describe(&origin).await {
                if let Some(child) = pending {
                    let _ = kill_child(child).await;
                }
                let snapshot = DshHostSnapshot {
                    origin,
                    host: settings.host.clone(),
                    port: settings.port,
                    ownership: DshHostOwnership::Adopted,
                    describe,
                };
                guard.live = Some(LiveHost {
                    snapshot: snapshot.clone(),
                    child: None,
                });
                log::info!("[dsh] adopt-after-spawn-race {}", snapshot.origin);
                return Ok(snapshot);
            }
            if let Some(child) = pending {
                let _ = kill_child(child).await;
            }
            Err(classify_spawn_error(&origin, &spawn_err))
        }
    }
}

/// Probe an already-running host. Never spawn.
pub async fn connect_existing(settings: &DshRuntimeSettings) -> Result<DshHostSnapshot, String> {
    remember_endpoint(&settings.host, settings.port);
    let origin = origin_from_host_port(&settings.host, settings.port);
    if let Some(live) = current_snapshot().await {
        if live.origin == origin && probe_describe(&live.origin).await.is_ok() {
            return Ok(live);
        }
    }
    let describe = probe_describe(&origin).await?;
    Ok(DshHostSnapshot {
        origin,
        host: settings.host.clone(),
        port: settings.port,
        ownership: DshHostOwnership::Adopted,
        describe,
    })
}

/// Drop the supervisor handle. Adopted hosts are never killed.
pub async fn drop_host() {
    let mut guard = state().lock().await;
    abort_pending_unlocked(&mut guard).await;
    drop_unlocked(&mut guard, true).await;
}

/// Cancel an in-flight spawn. Adopted hosts stay running.
pub async fn cancel_start() -> Result<(), String> {
    stop_host(&DshRuntimeSettings::default()).await
}

/// Stop a settings-page start or a live local host. Remote origins are never killed.
pub async fn stop_host(settings: &DshRuntimeSettings) -> Result<(), String> {
    let origin = origin_from_host_port(&settings.host, settings.port);
    let live = {
        let mut guard = state().lock().await;
        abort_pending_unlocked(&mut guard).await;
        guard.live.take()
    };
    if let Some(mut live) = live {
        if let Some(child) = live.child.take() {
            let _ = kill_child(child).await;
            log::info!("[dsh] stopped spawned host {}", live.snapshot.origin);
        }
    }
    if !is_local_host(&settings.host) {
        return Err("只能停掉本机 DSH host。远程地址不会被 mossx 关闭。".to_string());
    }
    if probe_describe(&origin).await.is_ok() {
        terminate_local_listener(settings.port)?;
        log::info!("[dsh] stopped local listener at {origin}");
    }
    Ok(())
}

fn is_local_host(host: &str) -> bool {
    matches!(
        host.trim().to_ascii_lowercase().as_str(),
        "127.0.0.1" | "localhost" | "::1" | "0.0.0.0" | "[::1]" | "[::]"
    )
}

#[cfg(unix)]
fn terminate_local_listener(port: u16) -> Result<(), String> {
    let output = crate::utils::std_command("lsof")
        .arg("-n")
        .arg("-P")
        .arg("-t")
        .arg(format!("-iTCP:{port}"))
        .arg("-sTCP:LISTEN")
        .output()
        .map_err(|error| format!("failed to inspect port {port}: {error}"))?;
    let pids = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect::<Vec<_>>();
    if pids.is_empty() {
        return Ok(());
    }
    for pid in pids {
        let status = crate::utils::std_command("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status()
            .map_err(|error| format!("failed to stop pid {pid}: {error}"))?;
        if !status.success() {
            let _ = crate::utils::std_command("kill")
                .arg("-KILL")
                .arg(pid.to_string())
                .status();
        }
    }
    Ok(())
}

#[cfg(windows)]
fn terminate_local_listener(port: u16) -> Result<(), String> {
    let output = crate::utils::std_command("netstat")
        .arg("-ano")
        .arg("-p")
        .arg("tcp")
        .output()
        .map_err(|error| format!("failed to inspect port {port}: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let needle = format!(":{port}");
    let mut pids = Vec::new();
    for line in stdout.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 || !cols[3].eq_ignore_ascii_case("LISTENING") {
            continue;
        }
        if cols[1].ends_with(&needle) {
            if let Ok(pid) = cols[4].parse::<u32>() {
                pids.push(pid);
            }
        }
    }
    for pid in pids {
        let _ = crate::utils::std_command("taskkill")
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/T")
            .arg("/F")
            .status();
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn terminate_local_listener(_port: u16) -> Result<(), String> {
    Err("stopping a local DSH host is not supported on this platform".to_string())
}

async fn abort_pending_unlocked(guard: &mut SupervisorState) {
    guard.spawn_generation = guard.spawn_generation.wrapping_add(1);
    if let Some(child) = guard.pending_child.take() {
        let _ = kill_child(child).await;
        log::info!("[dsh] cancelled pending host spawn");
    }
}

fn should_kill_host(ownership: DshHostOwnership, kill_spawned: bool) -> bool {
    kill_spawned && ownership == DshHostOwnership::Spawned
}

async fn drop_unlocked(guard: &mut SupervisorState, kill_spawned: bool) {
    let Some(mut live) = guard.live.take() else {
        return;
    };
    if should_kill_host(live.snapshot.ownership, kill_spawned) {
        if let Some(child) = live.child.take() {
            let _ = kill_child(child).await;
            log::info!("[dsh] stopped spawned host {}", live.snapshot.origin);
        }
    } else if live.snapshot.ownership == DshHostOwnership::Adopted {
        log::info!(
            "[dsh] leaving adopted host {} running",
            live.snapshot.origin
        );
    }
}

pub async fn probe_describe(origin: &str) -> Result<serde_json::Value, String> {
    let client = DshHostClient::new(origin.to_string())?;
    client.describe().await
}

pub fn resolve_dsh_bin(custom: Option<&str>) -> Result<String, String> {
    if let Some(custom) = custom.map(str::trim).filter(|value| !value.is_empty()) {
        let resolved = crate::backend::app_server::resolve_launchable_cli_binary(custom);
        let path = PathBuf::from(&resolved);
        if path.exists() {
            return Ok(resolved);
        }
        return Err(format!("DSH binary not found: {custom}"));
    }
    crate::backend::app_server::find_cli_binary("dsh", None)
        .map(|path| {
            crate::backend::app_server::resolve_launchable_cli_binary(&path.to_string_lossy())
        })
        .ok_or_else(|| "dsh CLI is not installed".to_string())
}

struct SpawnedProcess {
    child: Child,
    logs: Arc<std::sync::Mutex<String>>,
}

fn spawn_dsh_web(bin: &str, host: &str, port: u16) -> Result<SpawnedProcess, String> {
    #[cfg(windows)]
    repair_windows_dsh_sharp_esm(bin);
    let mut cmd = build_dsh_web_command(bin, host, port);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(false);
    apply_platform_spawn_context(&mut cmd, bin);
    let mut child = cmd.spawn().map_err(|error| {
        format!("failed to spawn `{bin} web --host {host} --port {port}`: {error}")
    })?;
    let logs = drain_child_stdio(&mut child);
    Ok(SpawnedProcess { child, logs })
}

/// Windows GUI cwd is often System32 / the install dir, which breaks first-run
/// DSH profile init. Mac / Linux keep the process cwd: the shebang `dsh` is a
/// real executable, and inheriting the app cwd matches the previous contract.
fn apply_platform_spawn_context(cmd: &mut Command, bin: &str) {
    #[cfg(windows)]
    if let Some(home) = dirs::home_dir() {
        cmd.current_dir(home);
    }
    if let Some(path_env) = crate::backend::app_server::build_codex_path_env(Some(bin)) {
        cmd.env("PATH", path_env);
    }
}

fn build_dsh_web_command(bin: &str, host: &str, port: u16) -> Command {
    #[cfg(windows)]
    {
        return build_windows_dsh_web_command(bin, host, port);
    }
    #[cfg(not(windows))]
    {
        // Mac / Linux: `dsh` is a real shebang script. Do not rewrite to
        // `node lib/bin.js` — that Windows workaround would skip nvm/hermes PATH
        // resolution the Unix wrapper already owns.
        let mut cmd = crate::backend::app_server::build_command_for_binary(bin);
        cmd.arg("web")
            .arg("--host")
            .arg(host)
            .arg("--port")
            .arg(port.to_string());
        cmd
    }
}

/// Windows npm bins are a POSIX shim + `.cmd` + `.ps1`. CreateProcess on the
/// shim is os error 193. `cmd /c dsh.cmd web …` also drops args when the path
/// is quoted. Prefer `node.exe lib/bin.js` so the long-lived host is our child.
#[cfg(windows)]
fn build_windows_dsh_web_command(bin: &str, host: &str, port: u16) -> Command {
    if let Some((node, script)) = resolve_windows_node_cli_launch(bin) {
        let mut cmd = crate::utils::async_command(node);
        cmd.arg(script)
            .arg("web")
            .arg("--host")
            .arg(host)
            .arg("--port")
            .arg(port.to_string());
        return cmd;
    }
    let bin_lower = bin.to_ascii_lowercase();
    if bin_lower.ends_with(".cmd") || bin_lower.ends_with(".bat") {
        let mut cmd = crate::utils::async_command("cmd");
        let line = format!(
            "\"\"{bin}\" web --host {host} --port {port}\"",
            bin = bin.replace('"', ""),
        );
        cmd.arg("/D").arg("/S").arg("/C").arg(line);
        return cmd;
    }
    let mut cmd = crate::backend::app_server::build_command_for_binary(bin);
    cmd.arg("web")
        .arg("--host")
        .arg(host)
        .arg("--port")
        .arg(port.to_string());
    cmd
}

#[cfg(windows)]
fn resolve_windows_node_cli_launch(bin: &str) -> Option<(String, PathBuf)> {
    let script = resolve_dsh_js_entry(bin)?;
    let node = crate::backend::app_server::find_cli_binary("node", None)?;
    Some((node.to_string_lossy().into_owned(), script))
}

/// Windows npm has been observed to extract `sharp/dist/constructor.mjs` as a
/// 0-byte file. The official tarball is not empty; Mac installs are fine.
/// `dsh web` then dies in `attachment-local` with "does not provide an export
/// named 'default'". Re-export the intact CJS twin. Never call this on Unix.
#[cfg(any(windows, test))]
const SHARP_CONSTRUCTOR_ESM_SHIM: &str = "\
import { createRequire } from 'node:module';\n\
const require = createRequire(import.meta.url);\n\
export default require('./constructor.cjs');\n";

#[cfg(windows)]
fn repair_windows_dsh_sharp_esm(bin: &str) {
    for path in sharp_constructor_mjs_candidates(bin) {
        match repair_empty_sharp_constructor_mjs(&path) {
            Ok(true) => log::warn!(
                "[dsh] repaired empty Windows sharp constructor.mjs at {}",
                path.display()
            ),
            Ok(false) => {}
            Err(error) => log::warn!("[dsh] Windows sharp constructor repair skipped: {error}"),
        }
    }
}

#[cfg(any(windows, test))]
fn sharp_constructor_mjs_candidates(bin: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Some(script) = resolve_dsh_js_entry(bin) else {
        return out;
    };
    let Some(dsh_pkg) = script.parent().and_then(Path::parent) else {
        return out;
    };
    push_unique(
        &mut out,
        dsh_pkg
            .join("node_modules")
            .join("sharp")
            .join("dist")
            .join("constructor.mjs"),
    );
    push_unique(
        &mut out,
        dsh_pkg
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh-attachment-local")
            .join("node_modules")
            .join("sharp")
            .join("dist")
            .join("constructor.mjs"),
    );
    if let Some(nm) = dsh_pkg.parent().and_then(Path::parent) {
        push_unique(
            &mut out,
            nm.join("sharp").join("dist").join("constructor.mjs"),
        );
    }
    out
}

#[cfg(any(windows, test))]
fn push_unique(out: &mut Vec<PathBuf>, path: PathBuf) {
    if !out.iter().any(|existing| existing == &path) {
        out.push(path);
    }
}

#[cfg(any(windows, test))]
fn repair_empty_sharp_constructor_mjs(constructor_mjs: &Path) -> Result<bool, String> {
    let constructor_cjs = constructor_mjs.with_file_name("constructor.cjs");
    if !constructor_cjs.is_file() {
        return Ok(false);
    }
    let needs_repair = match std::fs::metadata(constructor_mjs) {
        Ok(meta) => meta.len() == 0,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => {
            return Err(format!(
                "failed to stat {}: {error}",
                constructor_mjs.display()
            ));
        }
    };
    if !needs_repair {
        return Ok(false);
    }
    std::fs::write(constructor_mjs, SHARP_CONSTRUCTOR_ESM_SHIM)
        .map_err(|error| format!("failed to repair {}: {error}", constructor_mjs.display()))?;
    Ok(true)
}

fn resolve_dsh_js_entry(bin: &str) -> Option<PathBuf> {
    let path = Path::new(bin);
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    if ext.as_deref() == Some("js") && path.is_file() {
        return Some(path.to_path_buf());
    }
    let dir = path.parent()?;
    let candidate = dir
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js");
    candidate.is_file().then_some(candidate)
}

fn drain_child_stdio(child: &mut Child) -> Arc<std::sync::Mutex<String>> {
    let logs = Arc::new(std::sync::Mutex::new(String::new()));
    if let Some(stdout) = child.stdout.take() {
        spawn_stdio_drain(stdout, logs.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_stdio_drain(stderr, logs.clone());
    }
    logs
}

fn spawn_stdio_drain<R>(reader: R, logs: Arc<std::sync::Mutex<String>>)
where
    R: tokio::io::AsyncRead + Send + Unpin + 'static,
{
    tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut reader = reader;
        let mut buf = vec![0_u8; 4096];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if let Ok(mut slot) = logs.lock() {
                        if slot.len() >= SPAWN_LOG_LIMIT {
                            continue;
                        }
                        slot.push_str(&String::from_utf8_lossy(&buf[..n]));
                        if slot.len() > SPAWN_LOG_LIMIT {
                            slot.truncate(SPAWN_LOG_LIMIT);
                        }
                    }
                }
            }
        }
    });
}

fn read_spawn_logs(logs: &Arc<std::sync::Mutex<String>>) -> String {
    logs.lock().map(|slot| slot.clone()).unwrap_or_default()
}

fn log_suffix(logs: &str) -> String {
    let trimmed = logs.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    format!(" Output: {}", extract_spawn_log_summary(trimmed))
}

fn extract_spawn_log_summary(logs: &str) -> String {
    // Outer boot() wraps every plugin-tree failure as
    // `failed to apply loader entry include (cordis:include)`. Prefer the
    // inner `failed to import loader entry …` / native mismatch line so
    // Settings shows a cause the user can act on.
    let mut best: Option<(i32, &str)> = None;
    for line in logs.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let score = spawn_log_line_score(&trimmed.to_ascii_lowercase());
        if score <= 0 {
            continue;
        }
        if best
            .map(|(best_score, _)| score > best_score)
            .unwrap_or(true)
        {
            best = Some((score, trimmed));
        }
    }
    let text = best.map(|(_, line)| line).unwrap_or(logs).trim();
    if text.len() > 400 {
        format!("{}…", &text[..400])
    } else {
        text.to_string()
    }
}

fn spawn_log_line_score(lower: &str) -> i32 {
    if lower.contains("mismatched native koffi") {
        return 100;
    }
    if lower.contains("failed to import loader entry") {
        return 90;
    }
    if lower.contains("duplicate loader entry") {
        return 90;
    }
    if lower.contains("does not provide an export named 'default'") {
        return 85;
    }
    if lower.contains("not a valid win32") || lower.contains("os error") {
        return 70;
    }
    if lower.contains("failed to apply loader entry") && !lower.contains("cordis:include") {
        return 60;
    }
    if lower.contains("plugin tree") {
        return 40;
    }
    if lower.contains("error:") {
        return 30;
    }
    0
}

fn format_spawn_exit(origin: &str, status: std::process::ExitStatus, logs: &str) -> String {
    format!(
        "dsh web exited before becoming ready at {origin} ({status}).{}",
        log_suffix(logs)
    )
}

fn classify_spawn_error(origin: &str, spawn_err: &str) -> String {
    if spawn_err.contains("constructor.mjs")
        && spawn_err.contains("does not provide an export named 'default'")
    {
        return format!(
            "{spawn_err} Windows npm 常把 sharp/dist/constructor.mjs 装成 0 字节（Mac 完整安装不会）。请重装 `npm install -g @deepseek-ai/dsh` 后重试。"
        );
    }
    if spawn_err
        .to_ascii_lowercase()
        .contains("mismatched native koffi")
    {
        return format!(
            "{spawn_err} koffi JS 与 native `.node` 版本不一致（升级 `@deepseek-ai/dsh` 后 npm 常留下旧的 `@koromix/koffi-<platform>`）。请重装 `npm install -g @deepseek-ai/dsh`，或把官方 koffi 平台包对齐到当前 koffi 版本后再启动。"
        );
    }
    if spawn_err.contains("exited before becoming ready")
        || spawn_err.contains("not a valid Win32")
        || spawn_err.contains("os error 193")
    {
        return spawn_err.to_string();
    }
    if spawn_err.contains("HTTP")
        || spawn_err.contains("connection refused")
        || spawn_err.contains("timed out")
        || spawn_err.contains("os error 48")
        || spawn_err.contains("Address already in use")
        || spawn_err.contains("address already in use")
    {
        return format!(
            "port at {origin} is occupied by a non-DSH process or the spawned host never answered host.describe. Change dshPort or stop the other process. ({spawn_err})"
        );
    }
    spawn_err.to_string()
}

async fn wait_until_ready(origin: &str, generation: u64) -> Result<serde_json::Value, String> {
    let deadline = tokio::time::Instant::now() + SPAWN_READY_TIMEOUT;
    let mut last_error = "host.describe not ready".to_string();
    while tokio::time::Instant::now() < deadline {
        match probe_describe(origin).await {
            Ok(describe) => return Ok(describe),
            Err(error) => last_error = error,
        }
        {
            let mut guard = state().lock().await;
            if guard.spawn_generation != generation {
                return Err("DSH host start was cancelled.".to_string());
            }
            if let Some(status) = guard
                .pending_child
                .as_mut()
                .and_then(|child| child.try_wait().ok().flatten())
            {
                let logs = read_spawn_logs(&guard.pending_logs);
                return Err(format_spawn_exit(origin, status, &logs));
            }
        }
        tokio::time::sleep(SPAWN_POLL).await;
    }
    let logs = {
        let guard = state().lock().await;
        read_spawn_logs(&guard.pending_logs)
    };
    Err(format!(
        "spawned dsh web did not become ready at {origin}: {last_error}{}",
        log_suffix(&logs)
    ))
}

async fn kill_child(mut child: Child) -> Result<(), String> {
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let _ = tokio::task::spawn_blocking(move || {
            crate::utils::std_command("taskkill")
                .arg("/PID")
                .arg(pid.to_string())
                .arg("/T")
                .arg("/F")
                .status()
        })
        .await;
    }
    match child.kill().await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn client_for_snapshot(snapshot: &DshHostSnapshot) -> Result<Arc<DshHostClient>, String> {
    Ok(Arc::new(DshHostClient::new(snapshot.origin.clone())?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drop_kills_only_spawned_hosts() {
        assert!(should_kill_host(DshHostOwnership::Spawned, true));
        assert!(!should_kill_host(DshHostOwnership::Adopted, true));
        assert!(!should_kill_host(DshHostOwnership::Spawned, false));
        assert!(!should_kill_host(DshHostOwnership::Adopted, false));
    }

    #[test]
    fn spawn_ready_timeout_is_platform_specific() {
        #[cfg(windows)]
        assert_eq!(SPAWN_READY_TIMEOUT, Duration::from_secs(45));
        #[cfg(not(windows))]
        assert_eq!(SPAWN_READY_TIMEOUT, Duration::from_secs(20));
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_resolve_dsh_bin_keeps_shebang_even_if_cmd_sibling_exists() {
        let root =
            std::env::temp_dir().join(format!("ccgui-dsh-unix-shim-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let shebang = root.join("dsh");
        std::fs::write(&shebang, "#!/usr/bin/env node\n").expect("write shebang");
        std::fs::write(root.join("dsh.cmd"), "@echo off\n").expect("write cmd sibling");

        let resolved = resolve_dsh_bin(Some(shebang.to_string_lossy().as_ref()))
            .expect("unix shebang should stay launchable");
        assert_eq!(Path::new(&resolved), shebang.as_path());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn resolve_dsh_bin_prefers_cmd_when_posix_shim_is_configured() {
        let root =
            std::env::temp_dir().join(format!("ccgui-dsh-bin-shim-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let posix_shim = root.join("dsh");
        let cmd_path = root.join("dsh.cmd");
        std::fs::write(&posix_shim, "#!/bin/sh\n").expect("write posix shim");
        std::fs::write(&cmd_path, "@echo off\n").expect("write cmd wrapper");

        let resolved = resolve_dsh_bin(Some(posix_shim.to_string_lossy().as_ref()))
            .expect("posix shim should remap to cmd");
        assert_eq!(Path::new(&resolved), cmd_path.as_path());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_dsh_js_entry_from_npm_layout() {
        let root =
            std::env::temp_dir().join(format!("ccgui-dsh-js-entry-{}", uuid::Uuid::new_v4()));
        let script = root
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh")
            .join("lib")
            .join("bin.js");
        std::fs::create_dir_all(script.parent().expect("parent")).expect("create npm layout");
        std::fs::write(&script, "#!/usr/bin/env node\n").expect("write bin.js");
        let cmd_path = root.join("dsh.cmd");
        std::fs::write(&cmd_path, "@echo off\n").expect("write cmd wrapper");

        assert_eq!(
            resolve_dsh_js_entry(cmd_path.to_string_lossy().as_ref()),
            Some(script.clone())
        );
        assert_eq!(
            resolve_dsh_js_entry(script.to_string_lossy().as_ref()),
            Some(script)
        );
        assert_eq!(
            resolve_dsh_js_entry(root.join("missing.cmd").to_string_lossy().as_ref()),
            None
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn classify_keeps_windows_launch_and_early_exit_errors() {
        assert!(classify_spawn_error(
            "http://127.0.0.1:3080",
            "dsh web exited before becoming ready at http://127.0.0.1:3080 (exit code: 1). Output: %1 is not a valid Win32 application"
        )
        .contains("not a valid Win32"));
        assert!(
            classify_spawn_error("http://127.0.0.1:3080", "os error 193").contains("os error 193")
        );
        let constructor_err = classify_spawn_error(
            "http://127.0.0.1:3080",
            "dsh web exited before becoming ready at http://127.0.0.1:3080 (exit code: 1). Output: Error: dsh: plugin tree failed to load: The requested module './constructor.mjs' does not provide an export named 'default'",
        );
        assert!(constructor_err.contains("constructor.mjs"));
        assert!(constructor_err.contains("Windows npm"));
        assert!(constructor_err.contains("npm install -g @deepseek-ai/dsh"));
        let koffi_err = classify_spawn_error(
            "http://127.0.0.1:3080",
            "dsh web exited before becoming ready at http://127.0.0.1:3080 (exit code: 1). Output: Error: failed to import loader entry subprocess (@deepseek-ai/dsh-subprocess-local): Mismatched native Koffi modules",
        );
        assert!(koffi_err.contains("Mismatched native Koffi"));
        assert!(koffi_err.contains("@koromix/koffi-<platform>"));
        assert!(koffi_err.contains("npm install -g @deepseek-ai/dsh"));
        assert!(
            !koffi_err.contains("koffi-win32-x64"),
            "koffi hint must stay platform-neutral for Mac: {koffi_err}"
        );
    }

    #[test]
    fn repairs_zero_byte_sharp_constructor_mjs() {
        let root =
            std::env::temp_dir().join(format!("ccgui-dsh-sharp-empty-{}", uuid::Uuid::new_v4()));
        let dist = root.join("node_modules").join("sharp").join("dist");
        std::fs::create_dir_all(&dist).expect("create sharp dist");
        std::fs::write(
            dist.join("constructor.cjs"),
            "module.exports = function Sharp() {};\n",
        )
        .expect("write cjs");
        let mjs = dist.join("constructor.mjs");
        std::fs::write(&mjs, "").expect("write empty mjs");

        assert!(repair_empty_sharp_constructor_mjs(&mjs).expect("repair empty"));
        let body = std::fs::read_to_string(&mjs).expect("read repaired mjs");
        assert!(body.contains("createRequire"));
        assert!(body.contains("constructor.cjs"));
        assert!(!repair_empty_sharp_constructor_mjs(&mjs).expect("second repair is no-op"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn does_not_touch_healthy_sharp_constructor_mjs() {
        let root =
            std::env::temp_dir().join(format!("ccgui-dsh-sharp-healthy-{}", uuid::Uuid::new_v4()));
        let dist = root.join("dist");
        std::fs::create_dir_all(&dist).expect("create dist");
        std::fs::write(dist.join("constructor.cjs"), "module.exports = 1;\n").expect("write cjs");
        let mjs = dist.join("constructor.mjs");
        std::fs::write(&mjs, "export default class Sharp {}\n").expect("write healthy mjs");

        assert!(!repair_empty_sharp_constructor_mjs(&mjs).expect("healthy skip"));
        assert_eq!(
            std::fs::read_to_string(&mjs).expect("read healthy"),
            "export default class Sharp {}\n"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn skips_sharp_repair_when_constructor_cjs_missing() {
        let root =
            std::env::temp_dir().join(format!("ccgui-dsh-sharp-no-cjs-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let mjs = root.join("constructor.mjs");
        std::fs::write(&mjs, "").expect("write empty mjs");

        assert!(!repair_empty_sharp_constructor_mjs(&mjs).expect("skip without cjs"));
        assert_eq!(std::fs::metadata(&mjs).expect("stat").len(), 0);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sharp_candidates_follow_npm_dsh_layout() {
        let root =
            std::env::temp_dir().join(format!("ccgui-dsh-sharp-cands-{}", uuid::Uuid::new_v4()));
        let script = root
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh")
            .join("lib")
            .join("bin.js");
        std::fs::create_dir_all(script.parent().expect("parent")).expect("create npm layout");
        std::fs::write(&script, "#!/usr/bin/env node\n").expect("write bin.js");
        let cmd_path = root.join("dsh.cmd");
        std::fs::write(&cmd_path, "@echo off\n").expect("write cmd wrapper");

        let candidates = sharp_constructor_mjs_candidates(cmd_path.to_string_lossy().as_ref());
        let hoisted = root
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh")
            .join("node_modules")
            .join("sharp")
            .join("dist")
            .join("constructor.mjs");
        assert!(
            candidates.iter().any(|path| path == &hoisted),
            "expected hoisted sharp constructor candidate, got {candidates:?}"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn spawn_log_summary_prefers_the_error_line() {
        let logs = "node noise\nError: dsh: plugin tree failed to load: sharp constructor\n    at boot (index.js:1186:9)\nNode.js v24.15.0\n";
        assert_eq!(
            extract_spawn_log_summary(logs),
            "Error: dsh: plugin tree failed to load: sharp constructor"
        );
    }

    #[test]
    fn spawn_log_summary_prefers_inner_koffi_mismatch_over_cordis_include() {
        let logs = "\
file:///…/dsh-app-boot/lib/index.js:1187
throw new Error(`${binName}: ${stage}: ${detail}${stack}`, { cause });
      ^

Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): loader entries failed to apply
AggregateError: loader entries failed to apply
    at EntryGroup.update (file:///…/cordis-plugin-loader/lib/index.js:91:35)
      [errors]: [
        Error: failed to import loader entry subprocess (@deepseek-ai/dsh-subprocess-local): Mismatched native Koffi modules
            at updateError (file:///…/cordis-plugin-loader/lib/index.js:299:9)
        Error: failed to import loader entry sandbox (@deepseek-ai/dsh-sandbox-local): Mismatched native Koffi modules
      ]

Node.js v24.15.0
";
        let summary = extract_spawn_log_summary(logs);
        assert!(
            summary.contains("Mismatched native Koffi"),
            "expected inner koffi mismatch, got {summary}"
        );
        assert!(
            summary.contains("subprocess") || summary.contains("sandbox"),
            "expected named loader entry, got {summary}"
        );
        assert!(
            !summary.contains("cordis:include"),
            "outer include wrapper should not hide the inner cause: {summary}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_repair_entry_fixes_empty_constructor_in_npm_layout() {
        let root = std::env::temp_dir().join(format!(
            "ccgui-dsh-sharp-win-entry-{}",
            uuid::Uuid::new_v4()
        ));
        let script = root
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh")
            .join("lib")
            .join("bin.js");
        let dist = root
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh")
            .join("node_modules")
            .join("sharp")
            .join("dist");
        std::fs::create_dir_all(script.parent().expect("parent")).expect("create bin dir");
        std::fs::create_dir_all(&dist).expect("create sharp dist");
        std::fs::write(&script, "#!/usr/bin/env node\n").expect("write bin.js");
        std::fs::write(
            dist.join("constructor.cjs"),
            "module.exports = function Sharp() {};\n",
        )
        .expect("write cjs");
        std::fs::write(dist.join("constructor.mjs"), "").expect("write empty mjs");
        let cmd_path = root.join("dsh.cmd");
        std::fs::write(&cmd_path, "@echo off\n").expect("write cmd wrapper");

        repair_windows_dsh_sharp_esm(cmd_path.to_string_lossy().as_ref());
        let body = std::fs::read_to_string(dist.join("constructor.mjs")).expect("read repaired");
        assert!(body.contains("createRequire"));
        assert!(body.contains("constructor.cjs"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn windows_launch_prefers_node_script_when_npm_layout_exists() {
        let root =
            std::env::temp_dir().join(format!("ccgui-dsh-node-launch-{}", uuid::Uuid::new_v4()));
        let script = root
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh")
            .join("lib")
            .join("bin.js");
        std::fs::create_dir_all(script.parent().expect("parent")).expect("create npm layout");
        std::fs::write(&script, "console.log('ok')\n").expect("write bin.js");
        let cmd_path = root.join("dsh.cmd");
        std::fs::write(&cmd_path, "@echo off\n").expect("write cmd wrapper");

        let resolved = resolve_windows_node_cli_launch(cmd_path.to_string_lossy().as_ref());
        if crate::backend::app_server::find_cli_binary("node", None).is_some() {
            let (node, found_script) = resolved.expect("node + bin.js should resolve");
            assert!(node.to_ascii_lowercase().ends_with("node.exe") || node.ends_with("node"));
            assert_eq!(found_script, script);
        } else {
            assert!(resolved.is_none());
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn stop_only_targets_loopback_hosts() {
        assert!(is_local_host("127.0.0.1"));
        assert!(is_local_host("localhost"));
        assert!(!is_local_host("10.0.0.8"));
    }
}
