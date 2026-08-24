# dsh-engine-runtime Specification

## Purpose
TBD - created by archiving change fix-dsh-custom-route-image-admission. Update Purpose after archive.
## Requirements
### Requirement: Custom llm-pi-ai routes admit images without hand-editing DSH settings

When a DSH turn includes image parts and the selected model is served by a writable `llm-pi-ai` provider route that has not declared image input, mossx MUST declare `[text, image]` through Host RPC `settings.mutate` before `session.prompt`. mossx MUST NOT require the user to edit `$DSH_HOME/settings.yaml` or open the DSH Web UI for this declaration.

mossx MUST NOT invent a missing provider profile, MUST NOT write credentials /
baseURL / api, and MUST NOT rewrite a non-`llm-pi-ai` adapter such as
`llm-deepseek`.

#### Scenario: Hand-declared grok route has no image modalities

- **WHEN** the user sends an image on a DSH thread whose current model is a
  custom `llm-pi-ai` route such as `grok/grok-4.6`
- **AND** that route's model entry and `defaultInput` do not include `image`
- **AND** `settings.describe` reports the host writable
- **THEN** mossx SHALL call `settings.mutate` on `llm-pi-ai` to set
  `defaultInput` or that model entry's `input` to `[text, image]`
- **AND** mossx SHALL then call `session.prompt` with the image parts
- **AND** mossx SHALL NOT tell the user to edit DSH settings as the primary path

#### Scenario: Modalities already include image

- **WHEN** the selected `llm-pi-ai` model already declares `image` on the
  model entry or the route `defaultInput` covers an undescribed model
- **THEN** mossx SHALL NOT call `settings.mutate`
- **AND** mossx SHALL send `session.prompt` unchanged

#### Scenario: Official DeepSeek adapter stays text-only

- **WHEN** the selected provider is owned by a namespace other than `llm-pi-ai`
- **THEN** mossx SHALL NOT mutate DSH settings
- **AND** image admission SHALL remain the adapter's own declaration

#### Scenario: Settings cannot be written

- **WHEN** the host is read-only, the route has no `llm-pi-ai` profile, or
  `settings.mutate` is rejected
- **THEN** mossx SHALL fail closed before `session.prompt`
- **AND** the error SHALL explain that mossx could not declare image input
- **AND** the error MAY point at opening DSH Settings only as recovery

### Requirement: DSH is a first-class Native Engine

mossx SHALL expose DeepSeek Harness as engine id `dsh` with display name
`DeepSeek Harness`, protocol family `dsh-host-rpc`, and
`executionModel: persistent`. DSH SHALL NOT be modeled as a vendor preset or
an embedded Web UI.

#### Scenario: User selects DSH in the engine picker

- **WHEN** the user opens the composer engine / provider picker
- **THEN** mossx SHALL show a DSH group labeled DeepSeek Harness / DSH
- **AND** the provider mapping SHALL be `dsh` → `dsh` (not silently Claude)

#### Scenario: Protocol family is not stream-json

- **WHEN** the adapter registry reports the builtin `dsh` entry
- **THEN** `protocolFamily` SHALL be `dsh-host-rpc`
- **AND** `executionModel` SHALL be `persistent`

### Requirement: Global DSH host supervisor

mossx SHALL discover or start at most one `dsh web` host for the whole app.
Probe authority is `host.describe`. Ownership is `spawned` or `adopted`.

#### Scenario: User already runs dsh web

- **WHEN** `host.describe` succeeds on the configured host/port
- **THEN** mossx SHALL adopt that host
- **AND** mossx exit SHALL NOT kill the adopted process

#### Scenario: No healthy host and auto-start is on

- **WHEN** no `host.describe` succeeds and `dshAutoStart` is true
- **AND** a `dsh` binary is resolvable
- **THEN** mossx SHALL spawn `dsh web --host 127.0.0.1 --port <chosen>`
- **AND** wait for `host.describe` before treating the engine as ready
- **AND** mossx exit SHALL only kill that spawned process

#### Scenario: Windows spawn does not execute the POSIX shim

- **WHEN** mossx resolves `dsh` on Windows from an npm / Hermes prefix
- **THEN** spawn SHALL use a CreateProcess-safe launch (`node.exe` + `lib/bin.js`, or `dsh.cmd` via `cmd /D /S /C`)
- **AND** SHALL NOT execute the extensionless POSIX shim
- **AND** if the child exits before `host.describe` succeeds, the error SHALL include the child output

#### Scenario: Windows repairs empty sharp constructor.mjs before spawn

- **WHEN** mossx is about to spawn `dsh web` on Windows
- **AND** the resolved DSH tree has `sharp/dist/constructor.cjs` but `constructor.mjs` is missing or 0 bytes
- **THEN** mossx SHALL write a small ESM re-export shim (`createRequire` → `constructor.cjs`) in place
- **AND** SHALL NOT overwrite a non-empty `constructor.mjs`
- **AND** if the child still exits with `plugin tree` / `constructor.mjs` default-export, the error SHALL name this Windows npm 损坏并提示重装 `@deepseek-ai/dsh`

#### Scenario: Spawn error prefers inner plugin-tree cause over cordis:include

- **WHEN** spawned `dsh web` exits before `host.describe` succeeds
- **AND** child output wraps the failure as `failed to apply loader entry include (cordis:include)`
- **AND** an inner line names a real loader entry (`failed to import loader entry …` / `Mismatched native Koffi` / `duplicate loader entry`)
- **THEN** the surfaced error SHALL prefer that inner line over the `cordis:include` wrapper
- **AND** if the inner cause is `Mismatched native Koffi modules`, the error SHALL hint that npm 升级常留下旧的 `@koromix/koffi-<platform>`，并提示重装 `@deepseek-ai/dsh`
- **AND** this hint SHALL NOT name a Windows-only package such as `koffi-win32-x64`（Mac / Linux 走 `koffi-darwin-*` / `koffi-linux-*`）

#### Scenario: macOS spawn keeps the shebang binary

- **WHEN** mossx resolves `dsh` on macOS / Linux
- **THEN** spawn SHALL invoke that shebang path as `dsh web --host --port`
- **AND** SHALL NOT rewrite the launch to `node lib/bin.js`
- **AND** SHALL NOT change the child cwd to `$HOME`
- **AND** SHALL NOT repair or rewrite `sharp/dist/constructor.mjs`
- **AND** the ready timeout SHALL stay 20s

#### Scenario: Port is occupied by a non-DSH process

- **WHEN** TCP is open but `host.describe` fails
- **THEN** mossx SHALL NOT send session RPCs to that port
- **AND** it SHALL pick another port or surface a recoverable error

### Requirement: Native DSH session identity

A mossx DSH thread SHALL map 1:1 to a DSH `sessionId`. Canonical thread id is
`dsh:<sessionId>`. `dsh-pending-*` is only an optimistic alias before
`session.create` returns.

#### Scenario: New DSH session

- **WHEN** the user creates a DSH conversation in mossx workspace path P
- **THEN** mossx SHALL call `workspace.create({ path: P })` then
  `session.create({ workspaceId, agentPreset? })`
- **AND** if the composer selected a shipped Agent Preset, `agentPreset` SHALL
  be that id
- **AND** the backend SHALL use the returned DSH `sessionId` as canonical identity
- **AND** the backend SHALL NOT invent a durable UUID to stand in for it

#### Scenario: Pending promotion

- **WHEN** the composer shows `dsh-pending-*` before create returns
- **THEN** promotion SHALL merge that row into `dsh:<sessionId>`
- **AND** sidebar SHALL keep exactly one row

### Requirement: Prompt ACK and turn terminal

Input ACK MUST be the unary `session.prompt` `{ accepted: true }`. Logical
terminal MUST be mux/history `turn/end`. Host process liveness MUST NOT be a
turn terminal.

#### Scenario: Send a text turn

- **WHEN** the user sends text on a DSH thread
- **THEN** mossx MAY call `session.selectModel` if the `{ provider, model,
  reasoningEffort }` selection changed
- **AND** mossx SHALL call `session.prompt` with `mode: "queue"`
- **AND** mossx SHALL treat `{ accepted: true }` as input ACK only
- **AND** mossx SHALL settle the turn when `turn/end` arrives

#### Scenario: Stop

- **WHEN** the user stops an in-flight DSH turn
- **THEN** mossx SHALL call `session.cancel` and wait for turn settlement
- **AND** the DSH host process SHALL remain running

### Requirement: Live mux projection

mossx SHALL subscribe to the host live stream (`/api/events.mux`, WebSocket on
published 0.1.x) and project known DSH events into `NormalizedThreadEvent`.
Unknown event types SHALL be skipped.

#### Scenario: Streaming assistant text

- **WHEN** mux delivers `session/event` with `assistant/chunk` for the active thread
- **THEN** the curtain SHALL update via `liveAssistantTextChannel` / item delta
  channels
- **AND** the DSH engine SHALL be on the streaming whitelist so the cursor shows

### Requirement: Model catalog comes from the DSH host

`get_engine_models(Dsh)` SHALL call `llm.models` after ensure-host. Catalog
entries SHALL preserve the DSH `{ provider, model }` pair.

#### Scenario: Host has configured providers

- **WHEN** `llm.models` returns non-empty `groups`
- **THEN** the picker SHALL list `${providerName} / ${model.name}`
- **AND** the stored model id SHALL be sufficient to call `session.selectModel`

#### Scenario: Empty catalog

- **WHEN** the host is down, or no keys are configured, or only `failures[]` exist
- **THEN** mossx SHALL NOT show a generic “engine not installed” for a present CLI
- **AND** send SHALL stay disabled until a selectable model exists
- **AND** the copy SHALL point the user to open DSH Settings

### Requirement: DSH stays out of Shared Session

DSH SHALL NOT be added to `SHARED_SESSION_SUPPORTED_ENGINES` or
`is_supported_shared_session_engine()` in this change.

#### Scenario: Shared target picker

- **WHEN** the user opens Shared target selection
- **THEN** DSH SHALL be unavailable
- **AND** mossx SHALL show an unsupported reason
- **AND** persist / resolve paths SHALL reject a `dsh` Shared target instead of writing a DSH binding

### Requirement: Approval and question bridge

DSH `approval/requested` and `question/requested` SHALL reuse the existing
user-input elicitation UI. Answers SHALL go to `POST /api/respond` with the
mux frame `rpcId`.

#### Scenario: Tool asks for approval

- **WHEN** mux emits `approval/requested` for the active DSH session
- **THEN** mossx SHALL render the existing approval card
- **AND** the user's allow/reject SHALL be posted to `/api/respond`
- **AND** mossx SHALL NOT invent a DSH-only modal

#### Scenario: Agent asks the user a question

- **WHEN** mux emits `question/requested` for the active DSH session
- **THEN** mossx SHALL render the existing `RequestUserInputMessage` card
- **AND** submit SHALL post the full answer batch to `/api/respond`
- **AND** skip / dismiss / timeout without a recommended option SHALL cancel the mux waiter
- **AND** mossx SHALL NOT invent a DSH-only modal or require Plan mode

