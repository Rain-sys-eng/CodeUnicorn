## Context

Qoder Native L1 currently sends and receives through `qodercli --acp`. Its original history
implementation reused `session/list` / `session/load`, which makes every sidebar refresh and
history open pay for process spawn, ACP initialize, and replay drain. The recent tail-drain fix
is still required: Qoder may send the JSON-RPC response before trailing `session/update` events.

Qoder also persists clear-text session JSONL below its configured home. PI, Grok, and Kimi use
the corresponding on-disk records as their NativeHistoryReader while retaining their protocol
runtime for live turns. This change gives Qoder the same ownership split.

## Goals / Non-Goals

**Goals:**

- Make native disk JSONL the fast path for Qoder catalog list and session load.
- Preserve the existing frontend IPC schema and normalized `message` / `reasoning` / `tool`
  projection.
- Preserve ACP as a fallback when the local session artifact cannot be located, and as the
  only delete control-plane.
- Keep all realtime ACP behavior and its trailing-update regression protection unchanged.

**Non-Goals:**

- No vendor-file mutation, schema migration, live JSONL tailing, or new persistent cache.
- No Shared recovery change, Provider Continuation, remote sessions, or new Qoder auth surface.
- No frontend visual change: `qoderHistoryLoader` consumes the same payload.

## Decisions

### D1. Separate history storage from live protocol

`list_qoder_sessions` and `load_qoder_session` first resolve a local session file under the
configured Qoder home. The live `QoderSession` stays ACP-only for prompt, terminal, cancel,
permission handling, and streamed deltas.

Alternatives considered:

- Keep ACP for all reads and lower the idle drain: smaller code change, but does not remove
  cold-start latency or guard against vendor replay timing changes.
- Use disk only: fastest steady state, but a moved or changed vendor layout would turn a
  readable session into a hard failure.

Disk-primary with ACP fallback is selected because it matches PI/Grok/Kimi and retains a
vendor-supported escape hatch.

### D2. Resolve deterministic paths first, then use bounded workspace verification

The reader first probes O(1) project slug candidates produced from raw/canonical workspace
paths and the `/tmp` ↔ `/private/tmp` alias. A direct `sessionId.jsonl` lookup serves the
normal load path. If a slug is not represented by these candidates, a bounded scan of Qoder
project directories verifies the `workspace-directories` / `cwd` metadata before accepting a
file. This mirrors Grok's deterministic-path then workspace-filtered fallback.

The session id is normalized before all lookup. No vendor path component originates from an
unvalidated session id.

### D3. Keep the native parser loss-tolerant and streaming

The reader uses `BufReader` line iteration. Unknown or malformed lines are skipped; a single
bad line must not hide a valid session. User prompts derive from `humanInput.text` or visible
message content; assistant arrays project `thinking`, `text`, and `tool_use`; a later
`tool_result` merges onto its existing tool item. List summaries consume lightweight metadata
and file mtime; load streams the full selected JSONL.

The Rust data structures and Tauri command result remain unchanged, so no frontend adapter
change is necessary.

### D4. Define fallback precisely

`list_qoder_sessions` calls ACP only when local discovery cannot locate a workspace source;
an existing but empty workspace directory is a valid native empty result and must not pay a
CLI cold start.
`load_qoder_session` calls ACP only when it cannot locate a matching native file (or a
non-empty native file yields no recognized renderable records, signalling parser/layout drift).
ACP list remains soft-empty on failure; load preserves its existing error behavior.

Delete does not get a local fallback: `session/delete` is the only permitted mutation route.

## Risks / Trade-offs

- [Qoder changes JSONL layout] → deterministic lookup may miss or projection may be empty;
  ACP fallback remains available and focused fixtures cover current 1.1.28 shapes.
- [Many/large session files] → load is streaming; list stops after collecting its minimal
  summary evidence and uses file mtime instead of parsing every payload.
- [Workspace slug aliases] → raw, canonical, and `/tmp` variants are direct candidates;
  bounded metadata verification covers legacy/unknown slugs without cross-workspace leakage.
- [Realtime regression] → no `qoder.rs` live routing change; retain its existing `session/load`
  and `session/prompt` drain test unchanged.

## Migration Plan

1. Add deterministic and verified native path resolution plus JSONL parser tests.
2. Route the two existing history commands to native-first lookup and retain their ACP helpers.
3. Run focused Rust tests, Qoder engine checks, and OpenSpec validation.
4. Manual acceptance: reopen an existing tool-using Qoder session and send a new tool-using
   turn; confirm history opens promptly and live events still render.

Rollback is a contained revert of `qoder_history.rs`: ACP helpers are retained intact and are
already the old path. No user data requires migration or cleanup.

## Open Questions

- None for the current 1.1.28 local format. Future vendor schema changes are explicitly
  handled as an ACP-fallback event, not guessed in this change.
