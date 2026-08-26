//! Session L1 allowlist + OS-aware path canonicalization for DirectoryGrant.
//!
//! L1 = workspace root + startup --add-dir roots + runtime grants.
//! Symlink/junction escape after canonicalize is rejected (fail-closed).

use std::path::{Component, Path, PathBuf};

/// Grant lifetime for a directory root.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectoryGrantScope {
    Once,
    Session,
    Workspace,
}

impl DirectoryGrantScope {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "once" => Some(Self::Once),
            "session" => Some(Self::Session),
            "workspace" => Some(Self::Workspace),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Once => "once",
            Self::Session => "session",
            Self::Workspace => "workspace",
        }
    }
}

/// Normalize path separators and collapse `.` / `..` without requiring the path to exist.
pub fn normalize_path_lexically(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path is empty".to_string());
    }

    let raw = Path::new(trimmed);
    if !raw.is_absolute() {
        return Err("path must be absolute for directory grant".to_string());
    }

    let mut out = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::Prefix(p) => out.push(p.as_os_str()),
            Component::RootDir => out.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return Err("path escapes filesystem root".to_string());
                }
            }
            Component::Normal(seg) => out.push(seg),
        }
    }
    if out.as_os_str().is_empty() {
        return Err("path is empty after normalization".to_string());
    }
    Ok(out)
}

/// Best-effort canonical path: prefer `fs::canonicalize`, fall back to lexical normalize.
pub fn canonicalize_for_grant(path: &str) -> Result<PathBuf, String> {
    let lexical = normalize_path_lexically(path)?;
    match std::fs::canonicalize(&lexical) {
        Ok(canonical) => Ok(canonical),
        Err(_) => {
            // Parent may exist even if leaf does not (common for Read of missing file).
            if let Some(parent) = lexical.parent() {
                if let Ok(canonical_parent) = std::fs::canonicalize(parent) {
                    if let Some(name) = lexical.file_name() {
                        return Ok(canonical_parent.join(name));
                    }
                }
            }
            Ok(lexical)
        }
    }
}

/// Suggest the directory root to grant (parent of file targets; path itself if directory).
pub fn suggest_grant_root(path: &str) -> Result<PathBuf, String> {
    let canonical = canonicalize_for_grant(path)?;
    if canonical.is_dir() {
        return Ok(canonical);
    }
    canonical
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "cannot derive grant root".to_string())
}

/// Case-aware containment check after both paths are canonicalized.
pub fn path_is_within_root(candidate: &Path, root: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        let candidate_s = candidate.to_string_lossy().to_ascii_lowercase();
        let root_s = root.to_string_lossy().to_ascii_lowercase();
        candidate_s == root_s
            || candidate_s.starts_with(&format!("{root_s}{}", std::path::MAIN_SEPARATOR))
            || candidate_s.starts_with(&format!("{root_s}/"))
    }
    #[cfg(windows)]
    {
        let candidate_s = candidate.to_string_lossy().to_ascii_lowercase();
        let root_s = root.to_string_lossy().to_ascii_lowercase();
        let candidate_n = candidate_s.replace('/', "\\");
        let root_n = root_s.replace('/', "\\");
        candidate_n == root_n || candidate_n.starts_with(&format!("{root_n}\\"))
    }
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    {
        candidate == root || candidate.starts_with(root)
    }
}

/// True when candidate is inside any of the allowlist roots.
pub fn path_is_within_any_root(candidate: &Path, roots: &[PathBuf]) -> bool {
    roots
        .iter()
        .any(|root| path_is_within_root(candidate, root))
}

/// Sensitive roots that must not be granted whole without narrowing.
pub fn is_sensitive_grant_root(root: &Path) -> bool {
    let s = root.to_string_lossy();
    let lower = s.to_ascii_lowercase();
    if lower.ends_with("/.ssh") || lower.ends_with("\\.ssh") || lower.contains("/.ssh/") {
        return true;
    }
    if let Some(home) = dirs::home_dir() {
        if path_is_within_root(root, &home) && root == home.as_path() {
            return true;
        }
    }
    matches!(
        lower.as_str(),
        "/" | "c:\\" | "c:/" | "/system" | "/etc" | "/private/etc"
    )
}

/// Extract first absolute path-looking token from tool input JSON.
pub fn extract_absolute_path_from_tool_input(input: Option<&serde_json::Value>) -> Option<String> {
    let object = input?.as_object()?;
    for key in [
        "file_path",
        "filePath",
        "filepath",
        "path",
        "target_file",
        "targetFile",
        "filename",
        "file",
        "notebook_path",
        "notebookPath",
        "directory",
        "dir",
    ] {
        if let Some(value) = object.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() && Path::new(trimmed).is_absolute() {
                return Some(trimmed.to_string());
            }
        }
    }
    // Bash command may embed absolute paths.
    if let Some(command) = object
        .get("command")
        .or_else(|| object.get("cmd"))
        .and_then(|v| v.as_str())
    {
        if let Some(found) = extract_absolute_path_from_text(command) {
            return Some(found);
        }
    }
    None
}

/// Heuristic: find first absolute path substring in free text.
pub fn extract_absolute_path_from_text(text: &str) -> Option<String> {
    // Windows: C:\... or C:/...
    for token in text.split_whitespace() {
        let cleaned = token.trim_matches(|c: char| {
            matches!(
                c,
                '"' | '\'' | '`' | ',' | ';' | ')' | '(' | '[' | ']' | '{' | '}'
            )
        });
        if cleaned.len() >= 3 {
            let bytes = cleaned.as_bytes();
            if bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && (bytes[2] == b'\\' || bytes[2] == b'/')
            {
                return Some(cleaned.to_string());
            }
        }
        if cleaned.starts_with('/') && cleaned.len() > 1 {
            return Some(cleaned.to_string());
        }
    }
    None
}

/// Detect sandbox outside-allowlist denial messages.
pub fn looks_like_outside_allowlist_denial(message: &str) -> bool {
    let normalized = message.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    normalized.contains("allowed working directories")
        || normalized.contains("outside the allowed")
        || normalized.contains("not in the allowed")
        || normalized.contains("outside workspace")
        || (normalized.contains("sandbox")
            && (normalized.contains("path") || normalized.contains("directory")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_rejects_relative() {
        assert!(normalize_path_lexically("relative/path").is_err());
    }

    #[test]
    fn extract_unix_path_from_text() {
        let found = extract_absolute_path_from_text("read /Users/me/.claude/CLAUDE.md please");
        assert_eq!(found.as_deref(), Some("/Users/me/.claude/CLAUDE.md"));
    }

    #[test]
    fn extract_windows_path_from_text() {
        let found = extract_absolute_path_from_text(r"read C:\Users\me\.claude\CLAUDE.md please");
        assert_eq!(found.as_deref(), Some(r"C:\Users\me\.claude\CLAUDE.md"));
    }

    #[test]
    fn outside_allowlist_message_detected() {
        assert!(looks_like_outside_allowlist_denial(
            "This path is outside the allowed working directories for this session."
        ));
    }

    #[test]
    fn path_within_root_basic() {
        let root = PathBuf::from("/tmp/workspace");
        let inside = PathBuf::from("/tmp/workspace/src/main.rs");
        let outside = PathBuf::from("/tmp/other/file");
        assert!(path_is_within_root(&inside, &root));
        assert!(!path_is_within_root(&outside, &root));
    }

    #[test]
    fn scope_parse() {
        assert_eq!(
            DirectoryGrantScope::parse("session"),
            Some(DirectoryGrantScope::Session)
        );
        assert_eq!(DirectoryGrantScope::parse("always"), None);
    }
}
