# Delta: model-provider-catalog-runtime

## MODIFIED Requirements

### Requirement: Catalog Sources MUST Follow One Deterministic Precedence

Every engine model catalog MUST merge sources in `provider-owned runtime/configured > public user-configured > public generated fallback` order with deterministic dedupe. For a managed provider request, disk/global provider-specific configured entries MUST NOT be treated as public entries. Dedupe MUST use normalized runtime model identity, falling back to model ID when no runtime value exists. A managed **Codex** provider catalog MUST NOT append public generated fallback entries: Codex generated fallback rosters describe official OpenAI models whose availability is a property of the provider's relay, not of the binding; appending them to a third-party provider scope presents phantom selectable models. Claude / Kimi / Grok managed scopes retain the public append behavior.

#### Scenario: provider and public catalog contain same model

- **WHEN** a managed provider model and a public model resolve to the same normalized runtime model identity
- **THEN** the provider-owned metadata and label MUST win
- **AND** the model MUST appear once

#### Scenario: provider catalog appends public models

- **WHEN** a managed Claude Code, Codex, or Kimi provider catalog is requested
- **THEN** the result MUST include models configured by that provider
- **AND** for Claude / Kimi / Grok scopes it MUST append public user-configured and generated fallback models that do not duplicate provider models
- **AND** for Codex scopes it MUST NOT append public generated fallback entries
- **AND** it MUST NOT include configured models owned only by another managed provider or by the disk/global provider

#### Scenario: Codex managed scope contains only provider-owned rows

- **WHEN** a managed Codex provider catalog is requested and the provider has customModels or a configured default model
- **THEN** the result MUST contain only provider-owned rows (`provider-custom` / `provider-config`) and discovery-provided rows
- **AND** built-in / generated fallback ids (e.g. `gpt-5.x`) MUST NOT appear unless they are provider-owned entries

#### Scenario: Codex managed empty catalog falls back to configured default

- **WHEN** a managed Codex provider has no customModels and no configured model
- **THEN** the scoped catalog MUST be empty and the existing configured-default / custom-model guidance degrade paths apply
- **AND** the system MUST NOT substitute the public generated fallback roster to keep the list non-empty

#### Scenario: local profile preserves global catalog

- **WHEN** the request omits `providerProfileId` or identifies the engine's local/disk profile
- **THEN** the system MUST preserve the existing disk/global model catalog behavior
- **AND** it MUST NOT reinterpret the local profile as a managed isolated catalog
