# large-transcript-first-paint Specification

## Purpose
TBD - created by archiving change perf-large-transcript-first-paint. Update Purpose after archive.
## Requirements
### Requirement: History snapshot hydrate stays linear

`ConversationAssembler.hydrateHistory()` MUST assemble a history snapshot in linear time relative to snapshot item count. It MUST NOT copy the working item array once per incoming item, and it MUST NOT rescan the full working set to resolve identity when a `kind:id` key is already known.

The batch path MUST preserve existing snapshot merge semantics: hidden observations stay hidden, compact control tools stay compact, and same-identity / trailing-equivalent user, assistant, and reasoning items still merge. The live incremental `upsert` path MUST remain immutable and MUST NOT share the mutable working-set.

#### Scenario: Unique history items append without rewriting the whole list

- **WHEN** `hydrateHistory` receives a snapshot of 3000 unique conversation items
- **THEN** the assembled `items` length MUST equal 3000 in source order
- **AND** the implementation MUST reuse one working array rather than allocating a new full copy for every append

#### Scenario: Duplicate identity still merges

- **WHEN** a snapshot contains two items that share the same `kind` and `id`
- **THEN** `hydrateHistory` MUST keep a single merged item at that identity
- **AND** the visible result MUST match the pre-change merge semantics for that pair

### Requirement: First-paint turn retreat has a hard cap

First-paint (`dispatchThreadItemsProgressively` in `tail-first` mode) MUST compute its cut with `resolveHistoryWindowCutIndex` and MUST pass a `maxDisplayed` cap. The default cap MUST be `THREAD_ITEMS_FIRST_PAINT_MAX_DISPLAYED` (400). A mega-turn MUST NOT pull the entire transcript into the first store write.

A normal turn that only slightly overflows the 300-item budget MUST still retreat to that turn's first item, as long as the retreated window stays within the cap. `activeTurnId` pinning on the live DOM window MAY exceed the cap so an in-flight turn stays fully visible. The DOM history window of 800 MUST keep its current default when `maxDisplayed` is omitted.

`THREAD_ITEMS_FIRST_PAINT_COUNT` MUST remain 300. `DEFAULT_HISTORY_WINDOW_SIZE` MUST remain 800. `CLAUDE_UI_HISTORY_WINDOW` MUST remain 80.

#### Scenario: Shared turnId across thousands of items cannot first-paint the whole transcript

- **WHEN** a 2000-item snapshot uses the same `turnId` on every item
- **AND** first-paint runs in `tail-first` mode with the default 300 budget
- **THEN** the first `setThreadItems` write MUST contain at most 400 items
- **AND** the remainder MUST stay in `pendingOlderHistory`

#### Scenario: A small turn that straddles the 300 cut still stays whole

- **WHEN** the 300-item cut lands inside a turn of 20 items
- **AND** keeping that whole turn still stays within the 400 cap
- **THEN** the cut MUST retreat to that turn's first item
- **AND** first-paint MUST NOT use a bare `slice(-300)` that splits the turn

#### Scenario: Medium chats do not grow a chip just because this change landed

- **WHEN** a session has 250 items with distinct or missing turn ids
- **THEN** first-paint MUST write all 250 items
- **AND** no older-history chip MUST appear solely because the default 800/300 windows exist

### Requirement: Older-history pages stay viewport-sized and become visible

Clicking the earlier-history chip MUST prepend at most one memory page of pending items (`OLDER_HISTORY_REVEAL_PAGE_SIZE`, default 500). Scrolling toward the top MUST NOT start a page. The presentation window MUST increase its reveal budget by the prepended count so the newly prepended rows are visible. The default chip MUST NOT drain the entire remaining memory remainder in one click.

An adjacent explicit `All` control MAY drain the entire **memory** remainder in one click. `All` MUST NOT start a Claude disk `hasMore` page. Claude disk pages MUST still load at `CLAUDE_UI_HISTORY_WINDOW` (80). First-paint MUST stay tail-first (`THREAD_ITEMS_FIRST_PAINT_COUNT` / `THREAD_ITEMS_FIRST_PAINT_MAX_DISPLAYED`).

The counted chip copy MAY still show the remaining total before the click. Timeline virtualization MUST stay disabled. This requirement MUST NOT be satisfied by re-enabling `shouldVirtualizeTimelineRows` or lightweight summary rows.

#### Scenario: Memory pending prepends one page and those items render

- **WHEN** a thread has 900 pending older items and a 300-item first-paint tail
- **AND** the user activates the earlier-history chip
- **THEN** the requester MUST prepend 500 items, not all 900
- **AND** the presentation reveal budget MUST increase by 500
- **AND** the newly prepended items MUST be inside the presentation window
- **AND** the reveal budget MUST stay after prepend changes the first store item id; history-window reset MUST key off conversation scope, not `items[0].id`

#### Scenario: Presentation-only reveal expands by one page

- **WHEN** older items already live in the thread store and are collapsed only by the DOM window
- **AND** the user activates the earlier-history chip
- **THEN** the presentation reveal budget MUST increase by one page (500)
- **AND** the counted local remainder MUST decrease, not jump to 0

#### Scenario: All drains memory remainder only

- **WHEN** a thread has 900 pending older items
- **AND** the user activates the adjacent `All` control
- **THEN** the requester MUST prepend all 900 remaining memory items
- **AND** the requester MUST NOT start a Claude disk page
- **AND** if memory pending is empty, `All` MUST return without calling the disk loader

#### Scenario: Virtualization stays off

- **WHEN** a large transcript first-paints or reveals an older page
- **THEN** `shouldVirtualizeTimelineRows` MUST remain false
- **AND** the timeline MUST keep rendering the visible window as a static list

### Requirement: Older history loads only from explicit controls and keeps the reading slice

Scrolling the canvas toward the top MUST NOT start an older-history page. Only the earlier-history chip and the adjacent `All` control MAY request older history. The back-to-top control MAY scroll to `scrollTop = 0` but MUST NOT then auto-page.

After a chip or `All` click prepends older items, the canvas MUST keep the previously visible reading slice via the existing expansion `scrollHeight` delta restore. The system MUST NOT treat a prepend that only increases `userMessageCount` as a new user send, and MUST NOT `resumeFollowAndPin` / jump to the window bottom.

#### Scenario: scrolling to the top does not auto-page

- **WHEN** the user scrolls the canvas so `scrollTop` approaches 0
- **AND** memory pending or disk `hasMore` is true
- **THEN** the canvas MUST NOT call `requestOlderHistory`
- **AND** the earlier-history chip MUST remain the explicit load control

#### Scenario: chip prepend does not pin to the bottom

- **WHEN** the user is reading older history away from the bottom
- **AND** they click the earlier-history chip or `All`
- **AND** older user messages are prepended so `userMessageCount` increases
- **AND** the tail `latestUserMessageId` does not change
- **THEN** the viewport MUST stay on the previous reading slice
- **AND** the system MUST NOT `resumeFollowAndPin` as if a new message was sent

### Requirement: History classify does not scan full tool output

`classifyConversationObservation` MUST build its control probe from `rawType`, item kind, and at most the first `CONTROL_PROBE_SCAN_LIMIT` (2048) characters of `rawText`. It MUST NOT whitespace-collapse or line-split a full tool `output` body. Assembler snapshot upsert MUST pass tool `title` + `detail` as `rawText` and MUST NOT join `output` into the classify probe.

Hidden-control detection MUST still match markers that sit in the probe head.

#### Scenario: Huge tool output stays a visible tool

- **WHEN** a history tool item has a multi-hundred-KB `output` and a normal title/detail
- **THEN** classify MUST return a visible tool fact
- **AND** the probe MUST NOT include the full output body

#### Scenario: Control marker in the probe head still hides

- **WHEN** an assistant message starts with `<ccgui-approval-resume>` and then a long payload
- **THEN** classify MUST still mark it hidden-control-plane

### Requirement: Shared open hydrates a snapshot at most once

When Shared Phase-A has already successfully hydrated a snapshot, the open path MUST NOT run `hydrateHistory` or `hydrateHistorySnapshot` again on the same snapshot just to decide empty-retry or to re-apply V0. Sameness is `threadId` + item count + first item id + last item id.

An empty raw snapshot MAY still take the existing empty-retry path (except Shared, which stays fail-open). A later projection merge with a different paint key MUST hydrate.

#### Scenario: Phase-A V0 is not hydrated a second time when load returns the same items

- **WHEN** Shared Phase-A hydrates a non-empty V0 snapshot and drops the curtain
- **AND** `load()` later returns the same V0 items
- **THEN** the resume path MUST NOT dispatch a second `setThreadItems` for that snapshot

#### Scenario: Empty-retry does not classify a non-empty snapshot

- **WHEN** the first history snapshot already has `items.length > 0`
- **THEN** the empty-recovery helper MUST return it without calling `hydrateHistory` first

