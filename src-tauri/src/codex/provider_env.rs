//! Resolve provider-scoped environment variables for GUI-launched Codex.
//!
//! Finder/Dock launches do not necessarily inherit the user's interactive shell
//! environment. Codex configuration can name the variables it needs through
//! `model_providers.*.env_key`; resolve only those names and inject the values
//! into the Codex child process.

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

const FRAME_START_PREFIX: &str = "__CCGUI_CODEX_ENV_START__";
const FRAME_END_PREFIX: &str = "__CCGUI_CODEX_ENV_END__";
const RESOLUTION_TIMEOUT: Duration = Duration::from_secs(5);

/// One login-shell invocation resolves every missing key, so session launch
/// pays at most one bounded timeout instead of one spawn per key. `$0` is a
/// fixed placeholder; key names are validated shell identifiers passed as
/// positional arguments and are never interpolated into shell source.
const SHELL_SCRIPT: &str = r#"
for key in "$@"; do
  printf '%s%s\n' "__CCGUI_CODEX_ENV_START__" "$key"
  value=$(/usr/bin/printenv -- "$key" 2>/dev/null || true)
  printf '%s\n' "$value"
  printf '%s%s\n' "__CCGUI_CODEX_ENV_END__" "$key"
done
"#;

/// Apply values for provider `env_key`s that are absent from the GUI process.
pub(crate) async fn apply_codex_provider_env(command: &mut Command, codex_home: Option<&Path>) {
    let Some(config_path) = config_path(codex_home) else {
        return;
    };
    let Ok(contents) = tokio::fs::read_to_string(config_path).await else {
        return;
    };
    let missing: Vec<String> = collect_env_keys(&contents)
        .into_iter()
        .filter(|key| !env_has_non_empty_value(key))
        .collect();
    if missing.is_empty() {
        return;
    }
    let Some(resolved) = resolve_from_login_shell(&missing).await else {
        return;
    };
    for (key, value) in resolved {
        command.env(key, value);
    }
}

fn env_has_non_empty_value(key: &str) -> bool {
    env::var_os(key).is_some_and(|value| !value.is_empty())
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

async fn resolve_from_login_shell(keys: &[String]) -> Option<BTreeMap<String, String>> {
    let shell = allowed_shell()?;
    let mut command = Command::new(shell);
    command
        .arg("-l")
        .arg("-i")
        .arg("-c")
        .arg(SHELL_SCRIPT)
        .arg("ccgui")
        .args(keys);
    let output = timeout(RESOLUTION_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;
    Some(parse_framed_values(&output.stdout, keys))
}

/// zsh/bash only: their `-l -i -c script name args...` positional-parameter
/// semantics are what `SHELL_SCRIPT` relies on (fish/nushell/dash syntax is
/// incompatible, so they fail soft). Any absolute path is accepted (Homebrew
/// `/opt/homebrew/bin/zsh`, Linux `/usr/bin/bash`, ...); the basename decides.
fn allowed_shell() -> Option<PathBuf> {
    if let Some(shell) = env::var_os("SHELL") {
        return allowlisted_shell(Path::new(&shell)).map(Path::to_path_buf);
    }
    // GUI processes may not inherit SHELL at all; fall back to the platform
    // default and fail soft when it does not exist.
    let default = if cfg!(target_os = "macos") {
        Path::new("/bin/zsh")
    } else {
        Path::new("/bin/bash")
    };
    default.exists().then(|| default.to_path_buf())
}

fn allowlisted_shell(path: &Path) -> Option<&Path> {
    let name = path.file_name()?.to_str()?;
    ((name == "zsh" || name == "bash") && path.is_absolute()).then_some(path)
}

fn parse_framed_values(stdout: &[u8], keys: &[String]) -> BTreeMap<String, String> {
    let text = String::from_utf8_lossy(stdout);
    let mut values = BTreeMap::new();
    for key in keys {
        // Trailing newline makes the marker key-scoped, so `FOO` can never
        // match the frame of a prefix-colliding sibling like `FOO2`.
        let start_marker = format!("{FRAME_START_PREFIX}{key}\n");
        let end_marker = format!("{FRAME_END_PREFIX}{key}\n");
        let Some(start) = text.find(&start_marker) else {
            continue;
        };
        let value_start = start + start_marker.len();
        let Some(end) = text[value_start..].find(&end_marker) else {
            continue;
        };
        let value = text[value_start..value_start + end].trim();
        if !value.is_empty() {
            values.insert(key.clone(), value.to_string());
        }
    }
    values
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
    fn resolves_multiple_keys_with_shell_noise() {
        let keys = vec!["OPENAI_API_KEY".to_string(), "TEAM_OPENAI_KEY".to_string()];
        let stdout = format!(
            "instant-prompt noise\n{FRAME_START_PREFIX}OPENAI_API_KEY\nsecret-one\n\
             {FRAME_END_PREFIX}OPENAI_API_KEY\nmore noise\n{FRAME_START_PREFIX}TEAM_OPENAI_KEY\n\
             secret-two\n{FRAME_END_PREFIX}TEAM_OPENAI_KEY\ntrailing noise\n"
        );
        let values = parse_framed_values(stdout.as_bytes(), &keys);
        assert_eq!(
            values.get("OPENAI_API_KEY").map(String::as_str),
            Some("secret-one")
        );
        assert_eq!(
            values.get("TEAM_OPENAI_KEY").map(String::as_str),
            Some("secret-two")
        );
    }

    #[test]
    fn disambiguates_prefix_colliding_keys() {
        let keys = vec!["FOO".to_string(), "FOO2".to_string()];
        let stdout = format!(
            "{FRAME_START_PREFIX}FOO\none\n{FRAME_END_PREFIX}FOO\n\
             {FRAME_START_PREFIX}FOO2\ntwo\n{FRAME_END_PREFIX}FOO2\n"
        );
        let values = parse_framed_values(stdout.as_bytes(), &keys);
        assert_eq!(values.get("FOO").map(String::as_str), Some("one"));
        assert_eq!(values.get("FOO2").map(String::as_str), Some("two"));
    }

    #[test]
    fn keeps_missing_keys_out_of_result() {
        let keys = vec!["PRESENT".to_string(), "ABSENT".to_string()];
        let stdout = format!("{FRAME_START_PREFIX}PRESENT\nvalue\n{FRAME_END_PREFIX}PRESENT\n");
        let values = parse_framed_values(stdout.as_bytes(), &keys);
        assert_eq!(values.len(), 1);
        assert!(values.contains_key("PRESENT"));
    }

    #[test]
    fn rejects_injection_like_names() {
        assert!(!is_valid_env_name("OPENAI_API_KEY; touch /tmp/pwned"));
        assert!(!is_valid_env_name("1INVALID"));
        assert!(is_valid_env_name("CUSTOM_RELAY_TOKEN"));
    }

    #[test]
    fn allowlists_shell_by_basename_on_any_absolute_path() {
        assert_eq!(
            allowlisted_shell(Path::new("/opt/homebrew/bin/zsh")),
            Some(Path::new("/opt/homebrew/bin/zsh"))
        );
        assert_eq!(
            allowlisted_shell(Path::new("/usr/local/bin/bash")),
            Some(Path::new("/usr/local/bin/bash"))
        );
        assert_eq!(allowlisted_shell(Path::new("/bin/fish")), None);
        assert_eq!(allowlisted_shell(Path::new("zsh")), None);
    }
}
