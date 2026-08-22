## Context

Qoder is an ACP stdio Native engine with one child process per turn. The prior history change made vendor JSONL a read-only, fast primary path with ACP fallback. The current audit found a different class of issue: ACP protocol facts have been observed but are not consistently preserved through mossx runtime settlement, model discovery and product routing.

The worktree also contains an independent, unfinished `enable-qoder-shared-target` change. This change must not modify its files or claim that Qoder Shared is shipped.

## Goals / Non-Goals

**Goals:**

- Make selected model and reasoning effort fail closed before a prompt is sent.
- Treat Qoder prompt response as the terminal authority, including `stopReason: "cancelled"`.
- Use a single resolved config root for Qoder runtime, status/model discovery and doctor probes where configuration is available.
- Project prompt usage and route vendor-verified fork semantics through the existing Native send path.
- Preserve ACP fallback when the local history artifact is unusable.
- Make docs distinguish vendor capability evidence from product exposure.

**Non-Goals:**

- No persistent ACP host, provider CRUD, Shared wiring or direct mid-turn prompt UI.
- No change to vendor files, credentials or deletion policy.
- No general cross-engine rewrite of model discovery or cancellation.

## Decisions

### 1. Configuration setters are pre-prompt gates

`session/set_model` and `session/set_config_option` will propagate their contextual ACP error. A failed requested setting means no `session/prompt` is issued; silently continuing with a server default would violate the selected execution target.

Alternative considered: log and continue. Rejected because it makes the UI selection an unverifiable claim.

### 2. Cancel uses a two-stage terminal path

Interrupt records cancel intent, writes `session/cancel`, and leaves stdout ownership with the in-flight prompt request. The prompt response wins when it arrives. A bounded watchdog kills only a still-active child; forced kill synthesizes the same typed cancelled result only when the request was explicitly cancelled. Natural `end_turn` racing with cancel remains a successful terminal, not a fabricated cancellation.

Alternative considered: let `interrupt_turn` read stdout. Rejected because `QoderAcpProcess` already owns the stream and dual readers would corrupt JSON-RPC correlation.

### 3. One resolved Qoder launch context

Status and on-demand catalog APIs accept an optional `home_dir`, derived from `EngineConfig` at callers that have it. Runtime and diagnostics use that same resolved root where their command surface provides configuration. Default environment/home fallback remains only when no configured root exists.

Alternative considered: add a separate Qoder home setting to every doctor API. Rejected because `EngineConfig.home_dir` already expresses the runtime authority.

### 4. Fork is a session bootstrap variant

When `fork_session_id` is present, `send_message` calls `session/fork` instead of resume/new. Its returned `sessionId` follows the existing `SessionStarted` promotion path; later model/config setters and prompt run against that child. The existing Native send contract already transports `forkSessionId`; this change does not add a new Qoder-specific fork UI.

Alternative considered: create a Qoder-specific fork command/UI. Rejected because `SendMessageParams.fork_session_id` and the existing Native composer route already supply the smallest compatible surface.

### 5. Usage maps at terminal boundary

The prompt result's `usage.inputTokens` and `usage.outputTokens` are converted into `EngineEvent::UsageUpdate` before terminal completion. Unknown/missing values remain `None`; `_meta.quota` is intentionally not converted into billed usage.

### 6. Disk history fallback requires usable facts

The disk list operation returns explicit availability in addition to summaries. A directory that cannot be listed, a JSONL file that cannot be summarized, or no matching local source is unavailable and triggers ACP list fallback. A valid empty directory remains a soft-empty result and does not force a slow ACP request.

## Risks / Trade-offs

- [Cancel watchdog races natural terminal] → retain terminal response when it arrives first; watchdog only acts while the exact turn is still active.
- [Qoder stops returning usage fields] → emit no usage update rather than synthetic values.
- [Custom home is not available to a legacy doctor call] → preserve existing default fallback and document the limited diagnostic scope.
- [Vendor fork schema changes] → parse only documented `sessionId` aliases and fail the pre-prompt handshake with a contextual error.
- [Dirty concurrent worktree] → stage only files listed by this change; patch only scoped Qoder lines and append calibration text without replacing concurrent content.

## Migration Plan

1. Add focused unit/route tests before or alongside each runtime change.
2. Update Qoder Native runtime and history fallback.
3. Update calibration documents and add-qoder-engine supersession wording without changing Shared WIP semantics.
4. Run focused Rust/Vitest, matrix, daemon check and OpenSpec strict validation.
5. Commit only this change's files. Revert is one commit; no data migration is required.

## Open Questions

None. The product route and vendor evidence are both already present; this change only joins them under one contract.
