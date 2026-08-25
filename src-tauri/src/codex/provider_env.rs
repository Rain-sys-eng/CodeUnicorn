//! Resolve provider-scoped environment variables for GUI-launched Codex.
//!
//! Finder/Dock launches do not necessarily inherit the user's interactive shell
//! environment. Codex configuration can name the variables it needs through
//! `model_providers.*.env_key`; resolve only those names and inject the values
//! into the Codex child process.

use std::collections::BTreeSet;
use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

const FRAME_START: &str = "__CCGUI_CODEX_ENV_START__";
const FRAME_END: &str = "__CCGUI_CODEX_ENV_END__";
const RESOLUTION_TIMEOUT: Duration = Duration::from_secs(5);

const SHELL_SCRIPT: &str = r#"
printf '%s\n' "$2"
value=$(/usr/bin/printenv -- "$1" 2>/dev/null || true)
printf '%s\n' "$value"
printf '%s\n' "$3"
"#;

/// Apply values for provider `env_key`s that are absent from the GUI process.
pub(crate) async fn apply_codex_provider_env(command: &mut Command, codex_home: Option<&Path>) {
    let Some(config_path) = config_path(codex_home) else {
        return;
    };
    let Ok(contents) = tokio::fs::read_to_string(config_path).await else {
        return;
    };
    let keys = collect_env_keys(&contents);
    for key in keys {
        if env::var_os(&key).is_some_and(|value| !value.is_empty()) {
            continue;
        }
        if let Some(value) = resolve_from_login_shell(&key).await {
            command.env(&key, value);
        }
    }
}

fn config_path(codex_home: Option<&Path>) -> Option<PathBuf> {
    codex_home
        .map(Path::to_path_buf)
        .or_else(crate::codex::home::resolve_default_codex_home)
        .map(|home| home.join("config.toml"))
}

fn collect_env_keys(contents: &str) -> BTreeSet<String> {
    let Ok(value) = toml::from_str::<toml::Value>(contents) else {
        return BTreeSet::new();
    };
    value
        .get("model_providers")
        .and_then(toml::Value::as_table)
        .into_iter()
        .flat_map(|providers| providers.values())
        .filter_map(|provider| provider.get("env_key"))
        .filter_map(toml::Value::as_str)
        .map(str::trim)
        .filter(|key| is_valid_env_name(key))
        .map(ToOwned::to_owned)
        .collect()
}

fn is_valid_env_name(value: &str) -> bool {
    !value.is_empty()
        && value.chars().enumerate().all(|(index, ch)| {
            (index == 0 && (ch == '_' || ch.is_ascii_alphabetic()))
                || (index > 0 && (ch == '_' || ch.is_ascii_alphanumeric()))
        })
}

async fn resolve_from_login_shell(key: &str) -> Option<String> {
    let shell = allowed_shell();
    let output = timeout(
        RESOLUTION_TIMEOUT,
        Command::new(shell)
            .args([
                "-l",
                "-i",
                "-c",
                SHELL_SCRIPT,
                "ccgui",
                key,
                FRAME_START,
                FRAME_END,
            ])
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    parse_framed_value(&output.stdout)
}

fn allowed_shell() -> &'static str {
    match env::var("SHELL").ok().as_deref() {
        Some("/bin/zsh") | Some("/usr/bin/zsh") => "/bin/zsh",
        Some("/bin/bash") | Some("/usr/bin/bash") => "/bin/bash",
        _ => "/bin/zsh",
    }
}

fn parse_framed_value(stdout: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(stdout);
    let start = text.find(FRAME_START)? + FRAME_START.len();
    let end = text[start..].find(FRAME_END)? + start;
    let value = text[start..end].trim();
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_valid_provider_env_keys() {
        let keys = collect_env_keys(
            r#"
[model_providers.a]
env_key = "OPENAI_API_KEY"
[model_providers.b]
env_key = "TEAM_OPENAI_KEY"
[model_providers.c]
env_key = "bad-name"
"#,
        );
        assert_eq!(
            keys.into_iter().collect::<Vec<_>>(),
            ["OPENAI_API_KEY", "TEAM_OPENAI_KEY"]
        );
    }

    #[test]
    fn ignores_shell_noise_when_parsing_value() {
        let stdout = b"notice from .zshrc\n__CCGUI_CODEX_ENV_START__\nsecret-value\n__CCGUI_CODEX_ENV_END__\n";
        assert_eq!(parse_framed_value(stdout).as_deref(), Some("secret-value"));
    }

    #[test]
    fn rejects_injection_like_names() {
        assert!(!is_valid_env_name("OPENAI_API_KEY; touch /tmp/pwned"));
        assert!(!is_valid_env_name("1INVALID"));
        assert!(is_valid_env_name("CUSTOM_RELAY_TOKEN"));
    }
}
