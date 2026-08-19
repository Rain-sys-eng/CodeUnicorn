# Shared Provider Retry Design

Canonical product design: `docs/superpowers/specs/2026-08-20-shared-provider-retry-design.md`.

This change implements that spec. Implementation must not invent a second retry layer inside `sendSharedSessionTurnV2`. The controller sits after `turnCommitted` / known failed terminal, and re-enters the existing Shared send path with a resume prompt.

## Architecture

```text
classifySharedProviderRetryError  (pure)
providerRetryPolicy               (pure defaults / clamp / delay)
providerRetrySettingsStore        (memory, workspace::thread::engine)
providerRetryControllerStore      (overlay + series + timer)
useSharedProviderRetry            (observe send result, schedule submit)
SharedProviderRetryHint           (canvas row)
SharedProviderRetryToggle         (composer pill)
```

## Key constraints

- New Shared attempt only. Same engine / provider / model.
- Resume prompt is the new user message; images empty.
- Abort on user stop, new user send, target change, session switch, recovery-required, collab run.
- Fail closed on unknown errors.
