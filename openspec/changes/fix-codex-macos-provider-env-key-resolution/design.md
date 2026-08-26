# Design

## Runtime flow

1. `spawn_workspace_session_once` resolves the effective Codex home.
2. `provider_env` reads `config.toml` and collects valid `env_key` values under `model_providers`.
3. Non-empty inherited values are preserved.
4. Missing values are requested from an allowlisted `/bin/zsh` or `/bin/bash` using fixed `-l -i -c` command text and a positional variable-name argument.
5. Framed stdout parsing ignores shell startup noise and returns only the value.
6. The value is applied to the Codex `Command` immediately before spawn.

## Safety

- Variable names are validated as shell environment identifiers.
- Command text is fixed; user-controlled names are never interpolated into shell source.
- Resolution is bounded by a five-second timeout and fails soft.
- Secrets remain in the child process environment and are not logged or sent to the renderer.

## Compatibility

Existing process environment values continue to take precedence. Custom names such as `CUSTOM_RELAY_TOKEN` work exactly like `OPENAI_API_KEY`.
