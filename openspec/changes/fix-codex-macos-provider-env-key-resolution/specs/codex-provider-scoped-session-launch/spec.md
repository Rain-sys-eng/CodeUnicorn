# Codex provider-scoped session launch

## Requirement: Resolve provider environment keys for GUI launches

When the effective Codex configuration contains `model_providers.<provider>.env_key`, the desktop app MUST resolve a missing value from the user's allowlisted login/interactive shell before spawning the Codex app-server.

### Scenario: inherited value

- **GIVEN** the provider `env_key` is already present and non-empty in the ccgui process environment
- **WHEN** a Codex session is launched
- **THEN** the existing value is preserved

### Scenario: shell-only value

- **GIVEN** the provider `env_key` is absent from the ccgui process but exported by the user's login shell
- **WHEN** a Codex session is launched
- **THEN** the value is injected into the Codex child process

### Scenario: arbitrary provider variable

- **GIVEN** `env_key` is a legal custom name such as `CUSTOM_RELAY_TOKEN`
- **WHEN** a Codex session is launched
- **THEN** the same resolution path is used without hardcoding a provider name

### Scenario: resolution failure

- **GIVEN** config parsing, shell resolution, or timeout fails
- **WHEN** a Codex session is launched
- **THEN** the resolver fails soft and does not log or expose a secret
