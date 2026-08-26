# Design

## Runtime flow

1. `spawn_workspace_session_once` resolves the effective Codex home.
2. `provider_env` reads `config.toml` and collects valid `env_key` values under `model_providers`.
3. Non-empty inherited values are preserved; keys that are missing or empty are collected into one batch. No shell is spawned when nothing is missing.
4. A single allowlisted login/interactive shell invocation (`-l -i -c` with fixed script text) resolves every missing key in that batch. Variable names are validated shell identifiers passed as positional arguments, never interpolated into shell source.
5. Framed stdout parsing uses per-key start/end markers (key appended to the marker plus trailing newline), so shell startup noise is ignored and prefix-colliding names such as `FOO` vs `FOO2` stay unambiguous.
6. Values are applied to the Codex `Command` immediately before spawn.

## Safety

- Variable names are validated as shell environment identifiers.
- Command text is fixed; user-controlled names are never interpolated into shell source.
- Resolution is bounded by one five-second timeout for the whole batch (no per-key spawns) and fails soft.
- Secrets remain in the child process environment and are not logged or sent to the renderer.

## Compatibility

- Existing process environment values continue to take precedence. Custom names such as `CUSTOM_RELAY_TOKEN` work exactly like `OPENAI_API_KEY`.
- Shell allowlist: any absolute path whose basename is `zsh` or `bash`（Homebrew `/opt/homebrew/bin/zsh`、Linux `/usr/bin/bash` 等）；unsupported shells（`fish` / `nushell` / `dash`，`-c` 语义不兼容）fail soft。`SHELL` 未继承时 macOS 兜底 `/bin/zsh`、其余平台 `/bin/bash`。
- `-i` 是有意取舍：多数用户的 provider key 导出在 `~/.zshrc`，只有 interactive shell 才加载；`-l` alone 会漏掉这些值。启动噪音由 framing 容忍，挂死由单一 timeout 兜底。
- Windows：白名单永不命中，resolver 为 no-op；GUI 进程本就继承注册表 per-user 环境变量，该问题在 Windows 不存在，无需处理。
