# shared-canonical-projection Specification

## Purpose

定义 Shared Session V2 的 Canonical Fact 到 UI 单向投影层：支持 checkpoint
增量更新、全量 rebuild、Legacy dual-read、Shadow comparison 与 Canvas
dark-launch regression gates。
## Requirements
### Requirement: Canonical Facts MUST Be Projected to ConversationItems

The `SharedProjector` MUST map each canonical fact in `shared_event_log` to a set of `ConversationItem`-compatible projection items. The projection MUST be one-way: UI items MUST NOT be used as a source of canonical facts.

#### Scenario: turnCommitted projects to assistant message and tool items

- **WHEN** a `conversation.turnCommitted` fact contains assistant text and two tool exchanges
- **THEN** the projector produces one `message` item for the assistant text
- **AND** one `tool` item per tool exchange
- **AND** each item has a stable checksum derived from the fact

#### Scenario: usageRecorded projects to usage metadata

- **WHEN** a `conversation.usageRecorded` fact is present
- **THEN** the projector produces a metadata item attached to the corresponding turn
- **AND** the item is marked as non-interactive

#### Scenario: control fact projects to system notice

- **WHEN** a `conversation.controlFact` fact indicates a cancel
- **THEN** the projector produces a system notice item with the control action

### Requirement: Projection MUST Support Checkpoint and Full Rebuild

The system MUST persist a `projectionVersion` and `throughSequence` checkpoint in `shared_projection_checkpoint`. When the projection cache is deleted or the version changes, the system MUST rebuild the projection from the full event log and produce identical item count, order, type, and checksums.

#### Scenario: incremental update uses checkpoint

- **WHEN** new events are appended after a previous projection
- **THEN** the projector reads the checkpoint
- **AND** only events with sequence greater than `throughSequence` are projected
- **AND** the checkpoint is updated to the new maximum sequence

#### Scenario: rebuild after cache deletion

- **WHEN** the projection cache is deleted and rebuild is triggered
- **THEN** the projector reads all events for the session
- **AND** produces the same item count, order, type, and checksums as the original projection

#### Scenario: version mismatch triggers rebuild

- **WHEN** the stored `projectionVersion` is lower than the current version
- **THEN** the projector invalidates the checkpoint
- **AND** performs a full rebuild

### Requirement: Shared Projection MUST Preserve Frozen Turn Identity

Shared canonical and legacy-compatible projection MUST carry the frozen execution identity from each Turn's authoritative snapshot into every projected assistant message and reload result. Projection MUST NOT substitute the currently selected target, current binding, or engine default for a completed Turn.

#### Scenario: projection rebuild preserves provider identity

- **WHEN** projection cache is deleted and rebuilt for a Shared Session containing Turns from multiple Providers
- **THEN** every rebuilt Turn badge MUST retain its original CLI, Provider, and Model snapshot
- **AND** rebuilt identity MUST match the pre-deletion projection

#### Scenario: live projection and reload agree

- **WHEN** a Turn is first shown from live canonical facts and later shown after application reload
- **THEN** both views MUST render the same frozen execution identity
- **AND** neither view MUST read the current composer target to label that Turn

### Requirement: Legacy Snapshot MUST Be Readable with Presentation-Only Fidelity

The `LegacySharedReader` MUST read legacy V0 snapshot files and map them to `ConversationItem` items with `fidelity = "presentation-only"`. The reader MUST NOT modify the legacy file, MUST NOT fabricate tool IDs, signatures, or targets, and MUST NOT write to `shared_event_log`.

#### Scenario: legacy snapshot opened read-only

- **WHEN** a legacy V0 snapshot file is opened
- **THEN** the reader produces `ConversationItem` items with `fidelity = "presentation-only"`
- **AND** the original file is unchanged

#### Scenario: legacy snapshot missing tool metadata

- **WHEN** a legacy snapshot contains tool calls without canonical IDs
- **THEN** the reader preserves the original text and marks the item as presentation-only
- **AND** no synthetic tool ID is generated

#### Scenario: legacy snapshot unreadable

- **WHEN** a legacy snapshot file is corrupted or missing
- **THEN** the reader returns a typed error
- **AND** no projection items are produced

### Requirement: Shadow Projection MUST Be Comparable to Legacy Dual-Read

The `ShadowComparator` MUST compare the projection of the A2 Shadow Canonical Log with the Legacy dual-read projection. It MUST produce a mismatch report and MUST NOT write to any storage.

#### Scenario: matching shadow and legacy

- **WHEN** the shadow projection and legacy projection contain the same items in the same order
- **THEN** the comparator reports zero mismatches

#### Scenario: shadow has extra items

- **WHEN** the shadow projection contains items not present in legacy
- **THEN** the comparator reports them as `shadow-only` mismatches

#### Scenario: legacy has extra items

- **WHEN** the legacy projection contains items not present in shadow
- **THEN** the comparator reports them as `legacy-only` mismatches

#### Scenario: item content mismatch

- **WHEN** an item exists in both projections but with different content
- **THEN** the comparator reports a `content-mismatch` with the item ID

### Requirement: Native and Shared Projections MUST Be Isolated

The frontend MUST maintain separate DataSources for Native and Shared sessions. Native sessions MUST NOT read from `shared_event_log`; Shared sessions MUST NOT read from Native history files. Switching between Native and Shared sessions MUST NOT cause duplicate Assistant Final, Tool Exchange breakage, or render storms.

#### Scenario: native session opens without shared DB access

- **WHEN** a Native session is opened
- **THEN** the Native DataSource is used
- **AND** no query is made to `shared_event_log`

#### Scenario: shared session opens without native history access

- **WHEN** a Shared session is opened
- **THEN** the Shared DataSource is used
- **AND** no query is made to Native history files

#### Scenario: shared target switch does not remount canvas

- **WHEN** the user switches the next-turn target from Claude to Codex within a Shared session
- **THEN** the Canvas component does not remount
- **AND** existing items are not rebuilt or flickered

#### Scenario: shared background binding does not cause render storm

- **WHEN** a Shared session has a background Binding running while the canvas is closed
- **THEN** no continuous AppShell/Canvas re-render occurs

### Requirement: Canvas Regression Gate MUST Pass

The system MUST pass the Native Canvas golden fixtures and render regression tests defined in §17.6. Any failure MUST block the Shared V2 merge.

#### Scenario: native golden fixtures pass

- **WHEN** Claude and Codex Native golden fixtures are loaded
- **THEN** item order, type, and content match the fixture expectations
- **AND** no Shared DB is accessed

#### Scenario: shared live produces single assistant final

- **WHEN** a Shared session receives streaming deltas followed by a terminal commit
- **THEN** the canvas shows exactly one Assistant Final item
- **AND** live text collapses into the final item without duplication

#### Scenario: shared projection rebuild is deterministic

- **WHEN** a Shared projection is deleted and rebuilt
- **THEN** item count, order, type, and checksum match the pre-deletion projection

### Requirement: Shared Projection Test Control MUST Be Discoverable And Reversible

系统 MUST 在 `设置 → 其他设置` 提供默认开启的 Shared Projection 控制开关。
该开关 MUST 复用现有 localStorage feature flag，MUST 明确标注关闭仅用于
Legacy-only rollback，且 MUST NOT 修改或删除 Canonical Event Log 与 Legacy snapshot。

#### Scenario: Tester enables Shared Projection

- **WHEN** 测试者开启 Shared Projection 测试开关
- **THEN** 系统 MUST 写入 `mossx.sharedProjection=1`
- **AND** 系统 MUST 刷新当前 WebView，使 Shared history loader 重新选择数据源

#### Scenario: Tester disables Shared Projection

- **WHEN** 测试者关闭 Shared Projection 测试开关
- **THEN** 系统 MUST 写入 `mossx.sharedProjection=0`
- **AND** 系统 MUST 刷新当前 WebView，使显式 Legacy-only rollback 生效

#### Scenario: Tester restores the default

- **WHEN** 测试者重新开启 Shared Projection
- **THEN** 系统 MUST 写入 `mossx.sharedProjection=1`
- **AND** 删除 local override 后系统 MUST 回到 build flag 或 default-on 语义

#### Scenario: Canonical Projection loading fails

- **WHEN** Shared Projection command 失败
- **THEN** 系统 MUST 可观测地回退到 V0 snapshot
- **AND** 测试入口 MUST NOT 修改或删除 Legacy snapshot

### Requirement: Foundation Checklist MUST Expose User-Visible Impact

多 CLI × 多 Provider 会话基石总任务清单 MUST 为 Wave 0–6 的每个任务明确说明
大白话目的、系统改变点与 UI 变化，且 MUST 保留原任务状态与阶段边界。

#### Scenario: Reader scans a task row

- **WHEN** 读者查看 Wave 0–6 任一任务
- **THEN** 该行 MUST 能直接判断任务解决什么问题
- **AND** 该行 MUST 能区分无 UI、间接 UI、仅开发者可见或用户可见变化

#### Scenario: Reader distinguishes Change A from Change B

- **WHEN** 读者查看 Change A 与 Change B 的任务说明
- **THEN** Change A MUST 标记为 dark launch 或默认无产品 UI 变化
- **AND** Change B MUST 明确标出真实 Send、Provider Binding 与用户操作面的计划变化

### Requirement: Canonical and Legacy dual-read MUST converge without transcript loss

While Shared canonical final snapshots do not contain every presentation transcript fact, the Shared history DataSource MUST use Legacy presentation snapshot order as the transcript base and merge canonical facts through the shared Conversation assembler. Canonical frozen identity MUST remain authoritative, while presentation-only reasoning and tool facts MUST remain visible and MUST NOT be written back as fabricated canonical facts.

#### Scenario: canonical assistant overlays legacy assistant identity
- **WHEN** Legacy snapshot and canonical projection contain equivalent assistant finals with different item IDs
- **THEN** dual-read convergence MUST render one assistant final
- **AND** that final MUST carry the canonical `TurnExecutionSnapshot`

#### Scenario: canonical projection lacks legacy reasoning
- **WHEN** Legacy snapshot contains reasoning for a Turn and canonical projection contains only user and assistant text for that Turn
- **THEN** the converged history MUST retain the Legacy reasoning in its original order
- **AND** MUST retain canonical target identity on the assistant final

#### Scenario: shared history remains isolated from native files
- **WHEN** Shared canonical and Legacy sources are converged
- **THEN** the loader MUST read only Shared storage sources
- **AND** MUST NOT read Claude or Codex Native history files

### Requirement: Shared history convergence MUST preserve transcript completeness monotonically

Canonical identity is authoritative for execution metadata, but canonical text MUST NOT downgrade a more complete Legacy presentation transcript. When two assistant facts in the same Turn have a strict normalized prefix relationship, dual-read convergence MUST retain the more complete body while merging canonical identity.

#### Scenario: truncated canonical prefix does not overwrite Legacy final
- **WHEN** a Legacy assistant final contains complete text and the matching canonical assistant contains only a strict prefix
- **THEN** history convergence MUST retain the complete Legacy body
- **AND** the result MUST retain canonical execution target metadata

#### Scenario: complete canonical final upgrades Legacy prefix
- **WHEN** a Legacy assistant contains only a streaming prefix and canonical contains the matching complete final
- **THEN** history convergence MUST retain the complete canonical body
- **AND** MUST produce one assistant final

#### Scenario: unrelated assistant bodies are not collapsed
- **WHEN** canonical and Legacy assistant bodies in a Turn have no normalized prefix or equivalence relationship
- **THEN** convergence MUST NOT discard either body merely by comparing length

### Requirement: Canonical Projection MUST Decode Legacy Type-Less Envelopes Safely

`SharedProjector` MUST use the immutable event row `fact_type` as the discriminator when a legacy
canonical `payload_json` object lacks its tagged `type`. It MUST NOT mutate the stored row or its
checksum, and it MUST fail closed when an embedded payload type conflicts with `fact_type`.

#### Scenario: legacy delivery fact omits type

- **WHEN** a Shared event stream contains a canonical `context.deliveryPrepared` or
  `context.deliveryAccepted` row whose object payload lacks `type`
- **THEN** the projector MUST decode that row using the same row's `fact_type`
- **AND** it MUST continue projecting later `conversation.turnRequested` and
  `conversation.turnCommitted` facts
- **AND** it MUST NOT rewrite the legacy row

#### Scenario: embedded type conflicts with durable fact type

- **WHEN** a canonical event payload contains a `type` different from the row `fact_type`
- **THEN** projection MUST return a typed error
- **AND** it MUST NOT select either type silently

#### Scenario: legacy recovery produces a checkpoint

- **WHEN** a type-less legacy stream is rebuilt successfully
- **THEN** projection MUST persist the normal versioned checkpoint through the final sequence
- **AND** subsequent incremental loads MUST preserve item order and checksum identity

### Requirement: turnRequested MUST project user image locators onto the user message item

When `CanonicalFact::TurnRequested` carries `input.image_refs`, `SharedProjector` MUST include those locators on the projected user `message` content as an `images` array of non-empty locator strings. Projection MUST NOT invent `generatedImage` items for user-attached input images.

#### Scenario: turnRequested with image_refs projects images array

- **WHEN** a turnRequested fact has `input.text = "hello"` and one `image_refs` entry with `locator = "/tmp/photo.png"`
- **THEN** the projector produces a user message projection item with `role=user`, `text` containing the user text
- **AND** `content.images` is a non-empty array that includes `"/tmp/photo.png"`
- **AND** no `generatedImage` item is created solely from those user input image_refs

#### Scenario: turnRequested without image_refs omits images field or empties it

- **WHEN** a turnRequested fact has text only and `image_refs` is absent or empty
- **THEN** the projected user message does not require an images list
- **AND** behavior remains backward compatible with existing text-only turns

### Requirement: Canonical Projection MUST Separate Squad Worker Presentation From Top-Level Conversation
The canonical projection layer MUST use durable owner metadata to keep every Squad Worker turn, including final Synthesize, out of top-level Conversation items and MUST expose Worker evidence only through `SquadProjectionV1`.

#### Scenario: linked attempt is excluded from timeline
- **WHEN** a requested, committed, or usage fact carries a durable Squad Worker binding
- **THEN** Shared Conversation projection omits its top-level rows without deleting its canonical evidence

#### Scenario: successful settlement publishes final answer
- **WHEN** `SquadRunSettled(status=succeeded)` carries the validated final summary
- **THEN** Shared Conversation projection publishes exactly one run-linked assistant answer without exposing the Synthesize Worker turn

#### Scenario: ordinary turn remains unchanged
- **WHEN** a committed Shared turn has no Squad attempt linkage
- **THEN** existing canonical-to-ConversationItem behavior remains unchanged

#### Scenario: rebuild preserves nesting
- **WHEN** projection is rebuilt after restart
- **THEN** the same attempts remain nested and no worker transcript flashes as a top-level conversation row

