# git-panel-diff-view Specification

## Purpose

Defines the git-panel-diff-view behavior contract, covering Dual List View Modes.
## Requirements
### Requirement: Dual List View Modes

The Git panel SHALL keep Diff-specific view actions discoverable from the `Diff`
mode menu without requiring a separate always-visible toolbar row, and SHALL NOT
expose repository switching from that menu.

#### Scenario: repository switcher is hidden from the Diff menu

- **WHEN** the active Git panel mode is `diff`
- **AND** repository scanning is available for the workspace
- **WHEN** the user opens the `Diff` mode menu
- **THEN** the menu SHALL NOT include an action to switch the Git repository used by the Diff panel
- **AND** the existing repository scan, clear, select, and selector-panel contracts SHALL remain available to non-menu callers.

#### Scenario: Git changes section header uses compact neutral controls

- **WHEN** the Git Diff panel renders staged or unstaged changes in flat or tree list mode
- **THEN** the section title SHALL keep staged and unstaged labels in the normal section text color instead of using success/green status color
- **AND** the section count SHALL render with the project shadcn Badge compact secondary treatment
- **AND** the manual refresh action SHALL stay hidden until the section header is hovered or keyboard-focused, matching the section Stage/Unstage action reveal behavior
- **AND** modified file status markers shown as `M` SHALL use the warning/yellow status color rather than the info/blue accent.

### Requirement: Multi-Repository Change Section Collapse

The multi-repository Diff surface SHALL provide functional staged and unstaged
section collapse controls scoped by workspace identity, repository identity, and section type.
Collapsing a section MUST remain a presentation-only operation.

#### Scenario: collapse one repository section

- **WHEN** the user activates a staged or unstaged section header in a repository group
- **THEN** that section SHALL update its expanded state and hide its file rows
- **AND** the header SHALL expose the current state through `aria-expanded`.

#### Scenario: collapse state is independently scoped

- **WHEN** the user collapses one staged or unstaged section
- **THEN** sections with another type, repository identity, or workspace identity SHALL retain their existing expanded state.

#### Scenario: collapse preserves Git and commit state

- **WHEN** the user collapses or expands a multi-repository section
- **THEN** the operation SHALL NOT change commit selection
- **AND** it SHALL NOT invoke stage, unstage, discard, refresh, or file-open behavior.

### Requirement: Tree Hierarchy Interaction

Tree mode SHALL support folder expand/collapse, file selection, and section-scoped commit inclusion toggles.

#### Scenario: Expand folder

- **WHEN** user expands a folder node
- **THEN** its child folders/files SHALL be visible

#### Scenario: Collapse folder

- **WHEN** user collapses a folder node
- **THEN** its descendants SHALL be hidden

#### Scenario: File metadata visibility

- **WHEN** tree mode renders file nodes
- **THEN** each node SHALL show file status and additions/deletions summary

---

#### Scenario: Folder checkbox reflects descendant commit inclusion state

- **WHEN** tree mode renders a folder inside one section
- **THEN** its checkbox SHALL reflect descendant file inclusion as `none`, `partial`, or `all`
- **AND** toggling that checkbox SHALL apply only to descendant files inside the same section

### Requirement: Single File Diff Focus in Tree Mode

Selecting a file in tree mode SHALL focus diff viewer on that file.

#### Scenario: Select file in tree

- **WHEN** user clicks a file node in tree mode
- **THEN** diff viewer SHALL show that file as focused diff content

#### Scenario: Clear focus

- **WHEN** user triggers “back to all” or clears selection
- **THEN** diff viewer SHALL return to non-focused aggregate state

---

### Requirement: File-Header Controls in Tree Focus Mode

In tree single-file focus mode, diff controls SHALL be attached to the current file header.

#### Scenario: Diff layout switch on file header

- **WHEN** user toggles split/unified controls in file header
- **THEN** current file diff SHALL switch between split and unified layout

#### Scenario: Diff content mode switch on file header

- **WHEN** user toggles `全文查看/区域查看` in file header
- **THEN** content mode SHALL apply to current focused file only

#### Scenario: No duplicated top toolbar

- **WHEN** file-header controls are available
- **THEN** top-level duplicated diff toolbar SHALL NOT be rendered

---

### Requirement: Full View Uses Full-Context Diff

`全文查看` SHALL render full-context diff (including unchanged lines), not only patch-near context.

#### Scenario: Full view data source

- **WHEN** user switches current file to `全文查看`
- **THEN** frontend SHALL request full-context diff for that file
- **AND** full view SHALL include unchanged lines in diff rendering

#### Scenario: Full view status feedback

- **WHEN** full-context diff request resolves
- **THEN** UI SHALL expose request state via button label/status (`FULL/EMPTY/ERR/...`)

---

### Requirement: Floating Change Anchors in Full View

Tree full-view mode SHALL provide floating anchor navigation between change groups.

#### Scenario: Anchor visibility

- **WHEN** current file is in tree mode and `全文查看`
- **THEN** floating anchor control SHALL be visible near diff viewport bottom-right

#### Scenario: Anchor grouping rule

- **WHEN** computing anchors for a file
- **THEN** contiguous changed lines SHALL be grouped as one anchor
- **AND** only line-number jumps create a new anchor

#### Scenario: Anchor navigation

- **WHEN** user clicks prev/next anchor button
- **THEN** viewport SHALL scroll to corresponding change anchor
- **AND** anchor counter SHALL update as `current/total`

---

### Requirement: Backward Compatibility for Git Actions

Existing Git actions and commit inclusion controls SHALL remain available in both view modes without breaking current diff workflows.

#### Scenario: Flat mode regression gate

- **WHEN** changes for tree keyboard/a11y/shortcut behavior are merged
- **THEN** automated regression checks SHALL cover flat mode Stage/Unstage/Revert and commit basics

#### Scenario: Tree interaction test coverage

- **WHEN** feature is implemented
- **THEN** automated tests SHALL cover tree build logic and focus-switch behavior

#### Scenario: Stage/Unstage/Revert in tree mode

- **WHEN** user performs stage/unstage/revert from tree mode
- **THEN** operation behavior SHALL match flat mode semantics

#### Scenario: Commit inclusion controls remain available in both modes

- **WHEN** user switches between `flat` and `tree`
- **THEN** both modes SHALL expose explicit controls to include or exclude files from the next commit

#### Scenario: View switch preserves section-scoped inclusion truth

- **WHEN** user stages / unstages files or changes commit inclusion in one mode and then switches view mode
- **THEN** the other mode SHALL reflect the same section-scoped inclusion state
- **AND** staged / unstaged file counts SHALL remain consistent after the switch

### Requirement: Tree Hierarchy Interaction Accessibility

Tree mode SHALL expose baseline accessibility semantics for assistive technology.

#### Scenario: Tree semantics for folders

- **WHEN** tree renders folder nodes
- **THEN** folder controls SHALL expose `aria-expanded`

#### Scenario: List semantics for actionable nodes

- **WHEN** tree renders selectable nodes
- **THEN** nodes SHALL expose descriptive labels and selected state metadata

---

### Requirement: Git Diff Panel MUST Expose Stable File Preview Affordances

The Git diff panel MUST expose explicit file-scoped preview affordances, and live workspace file review flows opened from those affordances MUST be able to escalate into editable review without breaking existing Git actions or selection semantics.

#### Scenario: file preview action is explicit from changed file rows

- **WHEN** a changed file row is visible in the Git diff panel
- **THEN** the row SHALL expose an explicit preview/open action
- **AND** the action SHALL be distinguishable from include/exclude, stage, unstage, discard, and selection controls

#### Scenario: commit scope outline stays visible in dense panels

- **WHEN** the user is selecting files for commit scope in a dense or high-contrast layout
- **THEN** selected commit-scope controls SHALL have a visible outline or equivalent state boundary
- **AND** the state SHALL remain distinguishable from hover-only styling

#### Scenario: file-scoped review entry can open editable review for live workspace diff

- **WHEN** the user opens a file-scoped live workspace diff review entry from the Git panel
- **THEN** the system MUST allow that review flow to enter editable review mode for the same file
- **AND** saving from that review flow MUST refresh the Git panel's live diff state

### Requirement: Git Diff Panel File Opens MUST Resolve Repository Paths To Workspace Paths

Git status and diff entries are repository-relative, while the file editor read pipeline consumes workspace-relative paths. The Git Diff panel MUST explicitly route changed-file open requests through a Git-path domain before invoking the shared editor open flow.

#### Scenario: Nested git root file open adds workspace prefix

- **GIVEN** the active workspace path is a parent directory of the configured Git root
- **AND** a changed file row path is relative to that Git root
- **WHEN** the user opens that changed file from the Git Diff panel
- **THEN** the editor open request MUST resolve the path to a workspace-relative path by prefixing the Git root's workspace-relative segment
- **AND** the shared file read pipeline MUST receive the resolved workspace-relative path

#### Scenario: Workspace root git file open does not add visual root label

- **GIVEN** the active workspace path is the configured Git root
- **WHEN** the user opens a changed file from the Git Diff panel
- **THEN** the editor open request MUST preserve the repository-relative file path
- **AND** it MUST NOT prefix the visible repository root name used by tree rendering

#### Scenario: Non-Git file open entrypoints remain workspace-relative

- **WHEN** a file is opened from the workspace file tree, search results, activity surface, Project Map evidence, or any other non-Git changed-file row entrypoint
- **THEN** the shared editor open flow MUST treat the input as workspace-relative or absolute workspace path according to the existing workspace file contract
- **AND** it MUST NOT apply the Git root prefix mapping unless the caller explicitly declares the path as Git-domain input

### Requirement: Remote Backend Git Diff Panel Reads

The Git Diff panel SHALL treat non-Git workspace diff reads as an empty,
non-error state across local Tauri and remote daemon backends.

#### Scenario: non-Git workspace does not emit diff command failures

- **WHEN** the active workspace root has no `.git` marker
- **THEN** Git status SHALL report `isGitRepository: false`
- **AND** automatic Git Diff preload SHALL NOT call `get_git_diffs`
- **AND** local Tauri and remote daemon `get_git_diffs` SHALL return an empty diff list if called
- **AND** the client SHALL NOT write a runtime/internal command failure notice for the non-Git diff path.

### Requirement: Git Diff Panel SHALL Use Canonical Change Projection

The Git Diff panel SHALL derive visible changed-file rows from a canonical projection that reconciles status entries and diff entries before rendering file lists or diff viewer inputs.

#### Scenario: Status entries remain authoritative
- **WHEN** a path exists in staged or unstaged status entries and matching diff evidence is available
- **THEN** the Git Diff panel MUST preserve the status-derived path, status, section, additions, deletions, and existing action semantics
- **AND** diff evidence MUST only enrich preview content or media metadata

#### Scenario: Diff-only added file remains visible
- **WHEN** diff evidence contains a file that is not present in the status-derived file list
- **AND** the diff evidence indicates a new file through optional status, `new file mode`, or `--- /dev/null`
- **THEN** the Git Diff panel MUST render that path as an added file instead of silently dropping it

#### Scenario: Diff-only deleted file remains visible
- **WHEN** diff evidence contains a file that is not present in the status-derived file list
- **AND** the diff evidence indicates deletion through optional status, `deleted file mode`, or `+++ /dev/null`
- **THEN** the Git Diff panel MUST render that path as a deleted file instead of silently dropping it

#### Scenario: Diff-only fallback entry is preview-only
- **WHEN** canonical projection creates a visible row from diff evidence without matching staged or unstaged status evidence
- **THEN** that row MUST allow non-mutating preview and focus behavior
- **AND** it MUST NOT expose stage, unstage, discard, or commit inclusion mutation controls until section state is confirmed by status evidence

#### Scenario: Staged and unstaged same-path state is preserved
- **WHEN** the same path has both staged and unstaged status entries
- **THEN** canonical projection MUST preserve both section-scoped entries
- **AND** stage, unstage, discard, preview, and commit inclusion controls MUST continue to target the same section semantics as before

#### Scenario: Canonical identities remain role-specific
- **WHEN** the same path appears in multiple Git panel responsibilities
- **THEN** file-list row identity MUST be section-scoped
- **AND** diff viewer identity MUST remain path-scoped
- **AND** mutation action identity MUST include section and operation semantics

### Requirement: Canonical Git Change Projection SHALL Be Cross-Platform

Canonical Git change projection SHALL behave consistently on Windows, macOS, Linux, and browser/Web Service surfaces.

#### Scenario: Path separators do not change file identity
- **WHEN** status or diff inputs refer to the same repository-relative file using `src/foo.ts` and `src\foo.ts`
- **THEN** canonical projection MUST treat them as the same logical Git path for merge purposes
- **AND** it MUST NOT rely on OS-specific path APIs to determine identity

#### Scenario: Line endings do not change status inference
- **WHEN** diff text uses LF or CRLF line endings
- **THEN** canonical projection MUST infer added, deleted, and modified fallback status consistently
- **AND** additions/deletions best-effort counting MUST classify `+` and `-` diff lines consistently across both line-ending styles

#### Scenario: Web Service and desktop use the same projection rules
- **WHEN** Git Diff panel data arrives from local desktop commands, remote daemon forwarding, or a Web Service-facing interface
- **THEN** the UI MUST apply the same canonical projection rules after data receipt
- **AND** Web-facing behavior MUST NOT diverge through a parallel status/diff merge implementation

#### Scenario: Incomplete Web-facing payloads are handled safely
- **WHEN** a Web-facing Git payload entry lacks `path`
- **THEN** canonical projection MUST discard that entry from visible changed-file rows
- **AND** it MUST use existing diagnostic/error reporting paths where available

#### Scenario: Missing diff does not create fallback entries
- **WHEN** a Web-facing or daemon diff payload omits `diff`
- **AND** no status-derived entry exists for that path
- **THEN** canonical projection MUST NOT synthesize a diff-only fallback row for that entry

### Requirement: Deleted File Rows SHALL Expose Explicit Deleted-State Visual Semantics

Deleted file rows in the Git Diff panel SHALL be visually distinguishable from modified and added files without changing existing actions or accessibility semantics.

#### Scenario: Deleted row uses explicit deleted styling
- **WHEN** a changed file row has status `D`
- **THEN** the row MUST expose a deleted-state visual treatment such as line-through, subdued text, or equivalent deleted affordance
- **AND** the status marker MUST remain distinguishable from added, modified, renamed, and typechange statuses

#### Scenario: Deleted styling preserves interaction affordances
- **WHEN** a deleted file row is selected, focused, hovered, or opened through keyboard interaction
- **THEN** the row MUST preserve existing focus, active, selected, preview, context menu, and commit inclusion affordances
- **AND** the deleted styling MUST NOT hide stage, unstage, discard, or preview controls that were available before

### Requirement: Git Diff Canonical Model SHALL Preserve Payload Compatibility

Git Diff panel canonical projection SHALL be compatible with existing local, remote daemon, and Web Service payloads that omit optional diff status.

#### Scenario: Optional diff status enriches projection
- **WHEN** a diff entry includes an optional status field
- **THEN** canonical projection MAY use that status for fallback entries
- **AND** status-derived staged or unstaged entries MUST still take precedence for existing paths

#### Scenario: Missing optional diff status remains supported
- **WHEN** a local, remote daemon, or Web-facing diff entry omits optional status
- **THEN** canonical projection MUST fall back to diff-header inference
- **AND** existing error handling, loading states, and return-shape compatibility MUST remain unchanged

#### Scenario: Rename headers infer rename display status
- **WHEN** a diff-only entry includes `rename from` and `rename to` headers
- **THEN** canonical projection MUST infer rename display status `R`
- **AND** it MUST NOT require deep rename pairing to preserve existing compatibility

### Requirement: Git Diff Canonical Model SHALL Respect Large-File Governance

Implementation of canonical Git change projection SHALL avoid increasing large-file debt and SHALL remain compatible with the large-file governance workflow.

#### Scenario: Implementation avoids mega-component growth
- **WHEN** canonical projection logic is implemented
- **THEN** merge, inference, path normalization, and stat counting logic MUST live in focused utility code rather than being embedded deeply in large React components
- **AND** component changes MUST remain thin wiring and presentation updates unless the design document records an explicit exception

#### Scenario: Large-file governance remains passable across OS matrix
- **WHEN** the change is ready for review
- **THEN** the implementation MUST be compatible with the workflow steps in `.github/workflows/large-file-governance.yml`
- **AND** it MUST remain suitable for `ubuntu-latest`, `macos-latest`, and `windows-latest` runners

### Requirement: Turn Semantic Diff Provides Evidence-Backed Review Facts

The session activity semantic diff SHALL provide evidence-backed review facts for a conversation turn, including deterministic diff-derived facts, validation command evidence, risk hints, and future AI review hints that reference evidence.

#### Scenario: Semantic facts carry structured evidence refs

- **WHEN** a semantic diff fact is rendered
- **THEN** the fact SHALL carry one or more structured evidence refs when concrete evidence exists
- **AND** the UI SHALL expose one compact evidence line without duplicating the same path in a second ref row
- **AND** file-backed evidence SHALL be actionable and open the referenced file line when line data exists
- **AND** long evidence labels and refs such as file paths SHALL wrap within the available surface instead of overflowing or being replaced by an ellipsis.

#### Scenario: Validation command evidence is connected

- **WHEN** a turn contains command events that run validation commands such as tests, lint, typecheck, or OpenSpec validation
- **THEN** the semantic diff SHALL render those commands as validation evidence
- **AND** completed commands SHALL be distinguished from failed commands.

#### Scenario: Test files are not treated as executed tests

- **WHEN** a turn changes test files but has no validation command evidence
- **THEN** the semantic diff MAY show a test-file coverage hint
- **AND** it SHALL NOT claim that tests were run successfully.

#### Scenario: TypeScript and React facts are extracted from hunks

- **WHEN** a turn's diff hunk adds TypeScript exports, React components, hooks, state hooks, or event handlers
- **THEN** the semantic diff SHALL describe those concrete facts when extractable
- **AND** it SHALL cite the file or hunk evidence.

#### Scenario: Test assertion facts are extracted from hunks

- **WHEN** a turn's diff hunk adds test cases or assertions
- **THEN** the semantic diff SHALL describe the added test coverage or assertion surface when extractable
- **AND** it SHALL keep confidence bounded to the diff evidence.

#### Scenario: AI review facts require evidence

- **WHEN** future AI review facts are supplied to the semantic diff model
- **THEN** facts without evidence refs SHALL be ignored
- **AND** AI-sourced facts SHALL render as review hints rather than verified deterministic facts.

#### Scenario: Deterministic facts remain visible with AI review

- **WHEN** AI review facts and deterministic rule facts are both available
- **THEN** the semantic diff SHALL preserve deterministic facts
- **AND** AI review SHALL augment rather than replace them.

### Requirement: Session Activity Shows Turn Artifacts And Semantic Diff

The session activity surface SHALL show which conversation turn produced which changed files and SHALL provide a turn-scoped semantic diff explaining likely change intent, behavior impact, risk, and validation evidence.

#### Scenario: User reviews AI-produced files by conversation turn

- **WHEN** a session activity turn contains one or more file-change events
- **THEN** the turn SHALL render a single artifact module for those changes
- **AND** the artifact module SHALL show a deduped file list rather than a separate `File change` timeline card per event.

#### Scenario: Activity category labels changed files as artifacts

- **WHEN** the session activity category tabs include file-change events
- **THEN** the user-facing tab label SHALL be "Artifacts" / "产物"
- **AND** it SHALL NOT be labeled "File" / "文件".

#### Scenario: Turn artifact module has file and semantic tabs

- **WHEN** the artifact module is visible in an expanded turn
- **THEN** it SHALL provide tabs for the artifact file list and semantic diff
- **AND** the semantic diff tab SHALL remain scoped to that same conversation turn.

#### Scenario: Semantic diff includes turn meaning

- **WHEN** the semantic diff tab is visible and the turn has a user message
- **THEN** the tab SHALL show a compact "Turn meaning" / "本轮语义" section before diff-derived facts
- **AND** the turn meaning SHALL render as escaped text rather than trusted HTML.

#### Scenario: Semantic diff uses compact layout

- **WHEN** semantic diff sections are visible in the session activity panel
- **THEN** the sections SHALL use a single-column layout
- **AND** the artifact header SHALL avoid stacking kicker, title, stats, and tabs across multiple rows when horizontal space allows.

#### Scenario: Turn artifact module uses flat visual treatment

- **WHEN** the artifact module is visible in an expanded turn
- **THEN** the module SHALL avoid outer card borders, inset shadows, raised shadows, and framed tab rails
- **AND** the artifact and semantic content SHALL read as a flat continuation of the turn rather than a nested card.

#### Scenario: Turn artifact content is left-compact

- **WHEN** the artifact file list is visible in an expanded turn
- **THEN** the module SHALL keep left indentation compact relative to nested cards
- **AND** file rows SHALL avoid excessive inner left padding that visually detaches file names from the turn content.

#### Scenario: Turn artifact tabs remain scannable without chrome

- **WHEN** the artifact module tab controls are visible
- **THEN** each tab SHALL include a leading icon plus label
- **AND** the icons SHALL NOT require bordered or raised button chrome to communicate the two modes.

#### Scenario: Concrete code facts are available

- **WHEN** a turn's diff hunk includes concrete code tokens such as exception handlers, endpoint mappings, HTTP status mapping, response envelope calls, exports, or public declarations
- **THEN** the semantic summary SHALL describe those concrete facts
- **AND** it SHALL NOT replace them with generic file-count or file-type statements.

#### Scenario: Evidence boundary is explicit

- **WHEN** the summary is derived only from diff evidence
- **THEN** the UI SHALL avoid presenting inferred statements as verified business facts
- **AND** validation status SHALL state when external validation evidence is not connected.

#### Scenario: Traditional diff remains available

- **WHEN** the user needs line-level evidence for a turn artifact file
- **THEN** the file row SHALL still allow opening the traditional diff preview or file location
- **AND** the standalone Git diff viewer SHALL remain focused on line-level diff review instead of adding a separate global semantic panel.

#### Scenario: Risk hints remain review aids

- **WHEN** the diff touches configuration, tests/specs, deleted files, large file sets, or behavior-facing source files
- **THEN** the semantic summary MAY surface risk hints
- **AND** those hints SHALL NOT block Git actions or mutate commit selection.

### Requirement: Manual Git Status Refresh Affordance

The Git Diff panel SHALL expose a manual refresh affordance for the active workspace Git status without changing the existing automatic polling cadence. In multi-repository mode, each rendered repository change group SHALL expose the same aggregate status refresh affordance in its header.

#### Scenario: User manually refreshes Git status

- **WHEN** the Git Diff panel is visible for an active workspace
- **THEN** the panel SHALL render an icon button with an accessible refresh status label
- **AND** clicking the button SHALL invoke the existing Git status refresh callback.

#### Scenario: Multi-repository headers retain refresh parity

- **WHEN** the Git Diff panel renders repository change groups in multi-repository mode
- **THEN** each repository group header SHALL expose a keyboard-accessible refresh icon button
- **AND** activating any repository header refresh button SHALL invoke the existing aggregate repository status refresh callback
- **AND** an aggregate refresh already in flight SHALL disable the repository header refresh buttons until it settles.

#### Scenario: Manual refresh reuses existing status path

- **WHEN** the refresh affordance is activated
- **THEN** the frontend SHALL reuse the existing `refreshGitStatus` / queued refresh path
- **AND** it SHALL NOT introduce a new backend command or duplicate Git status bridge logic.

#### Scenario: Automatic polling remains unchanged

- **WHEN** the manual refresh affordance is added
- **THEN** the existing active/background Git status polling cadence SHALL remain unchanged
- **AND** existing Git diff, root scan, commit, stage, unstage, discard, and preview actions SHALL remain available.

### Requirement: Git Diff Status Polling Cadence

The Git Diff panel SHALL use a 15s Git status polling cadence for both active
and background modes.

#### Scenario: active and background polling use the same cadence

- **WHEN** a Git workspace remains open in active or background polling mode
- **THEN** the next Git status refresh SHALL be scheduled after 15s
- **AND** heavy changesets SHALL NOT extend the cadence beyond 15s.

### Requirement: Hub file selection uses one visual contract

Git Hub file sections MUST 让 row selection、checkbox state 与 section-level actions 表达同一 selected path set，且 selection styling MUST 不依赖另一个 panel 的 lazy CSS。

#### Scenario: Select files from a Hub section

- **WHEN** 用户在 changed、staged 或 untracked section 选择文件
- **THEN** row、checkbox 与 section action MUST 反映相同 selection，且切换 section 不得产生 phantom selection

### Requirement: Diff file opening preserves repository-relative identity

Git diff file opening MUST 结合 workspace root 与 repository-relative path 解析目标文件，sub-repository entry MUST NOT 被错误拼接到 parent repository root。

#### Scenario: Open a file changed in a sub-repository

- **WHEN** diff entry 属于 workspace 内的 nested Git repository
- **THEN** file open action MUST 定位到 nested repository 中的真实文件，而不得打开 parent root 下的同名或不存在路径

### Requirement: Git Diff Changed-File Context Menus SHALL Be Unified

The Git Diff panel SHALL expose the same `Git` context submenu for mutation-enabled changed-file rows in single-repository and multi-repository modes. The menu SHALL reuse the shared renderer context-menu surface and SHALL NOT fall back to the WebView native context menu.

#### Scenario: single and multi repository rows use the same Git submenu

- **WHEN** the user opens the context menu for a status-backed single-repository flat/tree row or multi-repository grouped row
- **THEN** the system SHALL prevent the WebView native context menu
- **AND** it SHALL render a root `Git` submenu using the shared `RendererContextMenu`
- **AND** repository topology SHALL NOT change the submenu presentation or action ordering.

#### Scenario: staged row exposes only unstage

- **WHEN** the user opens the Git submenu for a staged changed-file row
- **THEN** the submenu SHALL expose `Unstage file`
- **AND** it SHALL NOT expose Stage or Discard actions for that staged row.

#### Scenario: unstaged row exposes stage and discard

- **WHEN** the user opens the Git submenu for an unstaged changed-file row
- **THEN** the submenu SHALL expose `Stage file`
- **AND** it SHALL expose `Discard change` with destructive visual semantics
- **AND** it SHALL NOT expose Unstage for that unstaged row.

#### Scenario: disabled mutation row does not expose Git mutations

- **WHEN** a changed-file row is diff-only, `mutationDisabled`, stale, or has no available mutation callback
- **THEN** the system SHALL prevent the WebView native context menu
- **AND** it SHALL NOT expose Stage, Unstage, or Discard actions.

#### Scenario: opening a menu is presentation-only

- **WHEN** the user opens, navigates, dismisses, or cancels a changed-file context menu
- **THEN** the system SHALL NOT open the file, change commit inclusion, collapse a section, or refresh Git status
- **AND** it SHALL NOT execute a mutation until the user activates a concrete menu item.

#### Scenario: topology changes invalidate an open file menu

- **WHEN** the workspace, repository status topology, file section, mutation availability, or scoped callback changes while a changed-file context menu is open
- **THEN** the system SHALL close that file context menu
- **AND** the stale menu action SHALL NOT remain activatable against its previous target.

### Requirement: Git Diff File Context Actions MUST Preserve Repository And Section Scope

Every Git Diff file context action MUST target the clicked row's workspace, explicit repository identity, section, normalized repository-relative path, and operation. Context-menu actions SHALL reuse existing mutation, confirmation, and refresh paths instead of invoking a parallel Git service flow.

#### Scenario: same relative path in two repositories stays isolated

- **WHEN** two repository groups contain the same repository-relative path
- **AND** the user activates a context action on the second repository's row
- **THEN** the mutation callback MUST receive the second row's `repositoryRoot + path`
- **AND** it MUST NOT mutate the first repository.

#### Scenario: workspace-root repository identity remains explicit

- **WHEN** a multi-repository row belongs to `repositoryRoot === ""`
- **THEN** its context action MUST preserve the empty string as explicit workspace-root identity
- **AND** it MUST NOT fall back to a configured nested repository.

#### Scenario: same path in staged and unstaged sections follows clicked section

- **WHEN** the same path has staged and unstaged evidence
- **AND** the user opens the context menu on one section's row
- **THEN** the action matrix MUST be derived from the clicked section
- **AND** path-only matching MUST NOT expose operations from the sibling section.

#### Scenario: single repository bulk target remains section-local

- **WHEN** multiple selected rows include the context-menu target
- **THEN** a bulk context action MUST include only mutation-enabled selected paths from the clicked section
- **AND** it MUST NOT mutate selected paths from another section or repository.

#### Scenario: discard reuses confirmation and refresh

- **WHEN** the user activates Discard from an unstaged file context menu
- **THEN** the existing destructive confirmation dialog SHALL open before mutation
- **AND** cancel SHALL perform zero mutations
- **AND** confirm SHALL execute the existing current-repository or explicit-repository revert path
- **AND** a successful multi-repository revert SHALL refresh aggregate repository status exactly once.

#### Scenario: multi repository stage and unstage refresh once

- **WHEN** a multi-repository Stage or Unstage context action succeeds
- **THEN** the existing scoped mutation callback SHALL receive `repositoryRoot + path`
- **AND** the aggregate repository status refresh callback SHALL run exactly once.

### Requirement: Git Diff File Context Menu SHALL Expose Clicked-File History

The Git Diff panel SHALL expose `Git -> 显示文件历史` for a changed-file row when the host provides File History navigation and the row can be mapped to a valid workspace/repository/file identity. The History action MUST remain read-only and MUST target the clicked row rather than the current bulk mutation selection.

#### Scenario: Single root repository row opens file history

- **WHEN** the user activates `显示文件历史` for a single-repository changed-file row whose Git root is the workspace root
- **THEN** the system SHALL open File History with the active `workspaceId/workspacePath`
- **AND** it SHALL use `repositoryRoot=""` and the normalized repository-relative clicked path.

#### Scenario: Single nested repository row opens file history

- **WHEN** the active single repository is nested below the workspace root
- **AND** the user activates `显示文件历史` for one of its changed-file rows
- **THEN** the target SHALL use the normalized workspace-relative repository root
- **AND** `path` SHALL remain repository-relative while `displayPath` SHALL be workspace-relative.

#### Scenario: Multi repository row preserves explicit identity

- **WHEN** two repository groups contain the same relative path
- **AND** the user activates History on one group
- **THEN** the target MUST preserve that row's exact `repositoryRoot + path`
- **AND** `repositoryRoot=""` MUST remain an explicit workspace-root identity.

#### Scenario: History ignores bulk mutation selection

- **WHEN** multiple single-repository changed files are selected
- **AND** the user activates History from one clicked row
- **THEN** the system SHALL open exactly the clicked file's history
- **AND** it SHALL NOT derive the History target from the selected path collection.

#### Scenario: Read-only history remains available without mutations

- **WHEN** a valid status-backed row is diff-only or `mutationDisabled`
- **AND** the host provides File History navigation
- **THEN** the Git submenu SHALL expose `显示文件历史`
- **AND** it SHALL NOT expose Stage, Unstage, or Discard.

#### Scenario: Invalid history capability does not create a dead entry

- **WHEN** the host callback, workspace identity, repository scope, or valid relative path is unavailable
- **THEN** the system SHALL omit `显示文件历史`
- **AND** it SHALL preserve any independently available mutation actions.

#### Scenario: History menu target becomes stale

- **WHEN** workspace path, repository topology, or File History callback identity changes while a Git Diff file menu is open
- **THEN** the system SHALL close that file menu
- **AND** the previous History target SHALL NOT remain activatable.

### Requirement: Git changed-file surfaces share one renderer contract
主 Source Control、Git History worktree 与 commit details changed-file surfaces MUST 通过 canonical adapter 使用同一 flat/tree topology、file row 与 folder row renderer；页面容器 MUST NOT 维护等价的平行 row/tree JSX。

#### Scenario: Worktree surfaces render the same file model
- **WHEN** 主 Source Control 与 Git History worktree 展示同一组 staged/unstaged files
- **THEN** 两处 MUST 使用相同 status、path、folder、keyboard activation 与 collapse semantics

#### Scenario: Commit details uses read-only shared rows
- **WHEN** commit details 展示 historical changed files
- **THEN** 它 MUST 使用相同 shared renderer，并仅通过 adapter 禁用 worktree mutation actions

### Requirement: Shared changed-file renderer preserves domain actions
共享 renderer MUST 通过 typed callbacks/slots 接收 selection、inclusion、stage、unstage、discard 与 preview commands，且 MUST NOT 自行执行 Git service calls。

#### Scenario: Worktree action remains scoped
- **WHEN** 用户在 shared row 点击 stage、unstage、discard 或 inclusion control
- **THEN** renderer MUST 调用所属页面注入的 command，并阻止 row activation 抢占该 action

### Requirement: Git panel groups changed files by repository when necessary
The Git panel MUST use repository grouping only when multiple dirty repositories are visible, while preserving the existing single-repository file list contract。

#### Scenario: Single repository file list
- **WHEN** commit workspace contains exactly one dirty repository
- **THEN** file rows SHALL preserve existing flat/tree layout、status、preview 与 inclusion controls
- **AND** no redundant repository group header SHALL be rendered

#### Scenario: Multi repository file list
- **WHEN** commit workspace contains multiple dirty repositories
- **THEN** each repository SHALL have an accessible group header with repository name、branch and file count
- **AND** file rows within the group SHALL preserve existing status、preview and inclusion controls

### Requirement: Repository group selection composes with file selection
Repository headers and file rows MUST expose one coherent tri-state selection model scoped to their repository。

#### Scenario: Toggle an entire repository group
- **WHEN** user toggles a repository group inclusion control
- **THEN** all committable files in that repository SHALL change inclusion state
- **AND** files in other repositories SHALL remain unchanged

#### Scenario: Repository group is partially selected
- **WHEN** only part of a repository's committable files are included
- **THEN** repository header SHALL expose mixed selection state

### Requirement: Multi-Repository Changed-File Direct Opens MUST Preserve Repository Identity

The Git Diff panel MUST carry the owning `repositoryRoot` with every multi-repository changed-file direct-open request until the repository-relative path is projected into the shared workspace-relative editor path.

#### Scenario: Click a changed file in a nested repository

- **WHEN** 用户单击 multi-repository changed-file row
- **THEN** editor MUST open the file under that row's owning `repositoryRoot`
- **AND** the open action MUST NOT depend on or mutate the configured single-repository `gitRoot`

#### Scenario: Same relative path exists in different repositories

- **WHEN** two repositories each expose a changed file with the same repository-relative path
- **AND** 用户依次单击两个 rows
- **THEN** each open request MUST resolve to its distinct workspace-relative path
- **AND** one repository MUST NOT reuse the other repository's tab identity

#### Scenario: Workspace-root repository is explicitly selected by the row

- **WHEN** a multi-repository row belongs to the workspace-root repository represented by an empty `repositoryRoot`
- **THEN** its repository-relative path MUST remain workspace-relative without an added nested-root prefix
- **AND** a configured nested `gitRoot` MUST NOT override the explicit workspace-root identity

#### Scenario: Existing single-repository file open remains compatible

- **WHEN** a single-repository changed-file caller omits a repository override
- **THEN** the editor MUST continue resolving Git-domain paths through the configured `gitRoot`
- **AND** non-Git file entrypoints MUST continue treating their paths as workspace-domain inputs

### Requirement: Multi-Repository File Actions MUST Keep One Repository Scope Contract

Every multi-repository changed-file action that consumes a repository-relative path MUST either carry its owning `repositoryRoot` or intentionally operate on an already projected workspace-relative path.

#### Scenario: Repository-aware action audit

- **WHEN** direct open, modal preview, stage, unstage, commit selection, file tree decoration and file history entrypoints are exercised for multiple repositories
- **THEN** each Git-domain action MUST preserve the owning repository identity
- **AND** changed-file direct-open handlers MUST NOT be replaced by noop adapters

### Requirement: Multi-Repository Changed-File Preview Preserves Repository Identity

The Git Diff panel MUST open multi-repository changed-file modal previews using repository-scoped identity and MUST reuse the canonical editable review surface.

#### Scenario: Open preview from a multi-repository file row

- **WHEN** 用户点击 multi-repository changed-file row 的 modal preview action
- **THEN** Git Diff panel MUST 打开现有 unified preview modal
- **AND** patch 与 full-context diff reads MUST 使用该 row 所属的 `repositoryRoot`
- **AND** workspace edit target MUST resolve through the same repository root

#### Scenario: Same relative path exists in different repositories

- **WHEN** 两个 repository 都包含相同 repository-relative `filePath`
- **AND** 用户依次请求两个文件的 preview
- **THEN** modal MUST 展示最后一次请求 repository 的 diff
- **AND** earlier stale response MUST NOT overwrite the latest preview state

#### Scenario: Single-repository preview remains unchanged

- **WHEN** Git Diff panel 不处于 multi-repository mode
- **THEN** changed-file preview MUST continue using the existing single-repository `diffEntries` path
- **AND** system MUST NOT add a repository-scoped diff request to that existing activation path

#### Scenario: Selected single-repository preview loads editable baseline

- **WHEN** 左侧 Git panel 已选择 explicit `gitRoot` 并打开 changed-file preview
- **THEN** existing `diffEntries` MUST 继续作为 patch source
- **AND** editable compare baseline/full-context reads MUST 使用当前 `gitRoot`
- **AND** loading MUST settle to content or an explicit unavailable/error state

#### Scenario: Preview context changes while a request is in flight

- **WHEN** preview 打开或 repository-scoped request pending 时 `workspaceId`、single/multi mode 或 single-mode `gitRoot` 发生变化
- **THEN** previous request generation MUST become stale
- **AND** previous modal MUST close before it can edit against the new workspace context
- **AND** a late response MUST NOT reopen or overwrite preview state

### Requirement: Multi-Repository Change Groups Match Single-Repository Density

Multi-repository repository groups MUST preserve the shared changed-file renderer and SHALL use the single-repository file-row density baseline.

#### Scenario: Repository header uses compact file-row dimensions

- **WHEN** multi-repository change groups are rendered
- **THEN** each repository header SHALL use the shared `26px` file-row minimum-height baseline and shared typography/padding tokens
- **AND** repository metadata SHALL remain truncated and readable within a narrow Git side panel

#### Scenario: Changed-file rows do not gain multi-repository scaling

- **WHEN** staged or unstaged files render inside a repository group
- **THEN** file and folder rows MUST keep the same shared renderer dimensions used by single-repository mode
- **AND** multi-repository CSS MUST NOT introduce larger row-specific font size, icon size, or vertical padding

### Requirement: Desktop Git Mode Selector SHALL Live In The Right Panel Toolbar

Desktop right panel SHALL render the existing Git mode selector in the toolbar layer when the Git tab is active, without changing the selector's behavior or the responsive panel-tab contract.

#### Scenario: Active Git tab places selector before panel tabs

- **WHEN** the desktop right panel active tab is `git`
- **THEN** the current Git mode selector SHALL render in the `right-panel-toolbar` leading slot
- **AND** the responsive panel tabs SHALL remain in the same toolbar after that slot
- **AND** the Git content area SHALL NOT reserve an empty selector row when no other floating Git action is present.

#### Scenario: Non-Git tab does not retain selector

- **WHEN** the desktop right panel active tab changes from `git` to another tab
- **THEN** the toolbar SHALL NOT retain the Git mode selector or its menu
- **AND** the selected Git mode SHALL remain owned by the existing Git panel state.

#### Scenario: Current selector capabilities remain reachable

- **WHEN** the user opens or operates the relocated selector
- **THEN** Diff, Issues, Pull Requests, flat/tree list view, and the Git Graph action SHALL invoke their existing callbacks
- **AND** the hidden `log` mode SHALL remain compatible with non-menu callers
- **AND** outside click, Escape close with focus restore, configured list-view shortcut, and active-state accessibility semantics SHALL remain available.

#### Scenario: Lazy target fallback preserves reachability

- **WHEN** the Git panel renders before the toolbar mount target is available
- **THEN** the selector SHALL remain available through its existing inline location
- **AND** once the target becomes available the same selector behavior SHALL move to the toolbar without duplicated controls.

#### Scenario: Narrow and swapped desktop layouts remain usable

- **WHEN** the right panel is narrow or the desktop layout is swapped
- **THEN** the selector and responsive panel tabs SHALL remain within the toolbar layout
- **AND** the selector menu SHALL remain visible within the right panel bounds without horizontal overflow or toolbar clipping.

#### Scenario: Worktree action remains independent

- **WHEN** the Git panel exposes a worktree apply action
- **THEN** that action SHALL remain in its existing Git content action row
- **AND** relocating the mode selector SHALL NOT hide, move, or alter the worktree action callback.

### Requirement: Diff mode menu MUST expose one Git Graph history entry

The Git Diff mode menu MUST expose the existing Git History panel through a single `Git Graph` action and MUST keep the legacy `log` mode compatible with non-menu callers.

#### Scenario: menu presents one Git history navigation action

- **WHEN** the user opens the Git Diff mode menu
- **THEN** the menu SHALL show a `Git Graph` action with the `GitCommitHorizontal` icon
- **AND** the menu SHALL NOT show the legacy `Git` (`log`) selectable option

#### Scenario: Git Graph preserves the existing navigation callback

- **WHEN** the user activates the `Git Graph` action
- **THEN** the UI SHALL invoke the existing `onOpenGitHistoryPanel` callback exactly once
- **AND** no Git data operation SHALL be triggered directly by the menu action

#### Scenario: hidden log option remains compatible

- **WHEN** a non-menu caller activates the existing `log` mode
- **THEN** the panel MUST retain its existing `log` mode metadata and render behavior
- **AND** the UI-only menu change MUST NOT remove or alter the `log` mode type, state, callback, or data flow

#### Scenario: Sidebar uses the same Git Graph presentation

- **WHEN** the Sidebar settings menu renders its Git History action
- **THEN** the action SHALL use the `Git Graph` label and `GitCommitHorizontal` icon
- **AND** activating it SHALL preserve the existing `onAppModeChange` and menu-close behavior

#### Scenario: Git Graph quick action is visually emphasized

- **WHEN** the Git Diff mode menu renders the `Git Graph` action
- **THEN** its label SHALL use bold weight and a theme-aware accent color
- **AND** its icon SHALL use the same accent color across normal, hover, focus, and active states
- **AND** adjacent menu items SHALL retain their existing typography and color

### Requirement: Section header line-change summary badge

The single-repository Git Diff panel SHALL render a `+n-m` line-change summary
badge inside each staged and unstaged section header (both flat and tree view),
sitting visually adjacent to the existing file count badge. The badge MUST
aggregate additions and deletions across every file in that section.

#### Scenario: section header shows total line changes

- **WHEN** a staged or unstaged section contains one or more files with
  `additions` / `deletions` numbers
- **THEN** the section header SHALL render a `+n-m` badge where `n` equals the
  sum of `additions` across the section's files and `m` equals the sum of
  `deletions` across the section's files
- **AND** the existing file count badge SHALL continue to render unchanged.

#### Scenario: zero-totals hide the line summary badge

- **WHEN** a section contains files whose aggregated `additions` and
  `deletions` are both zero
- **THEN** the section header SHALL NOT render the `+n-m` badge.

#### Scenario: badge stays visible when section is collapsed

- **WHEN** the user collapses a staged or unstaged section
- **THEN** the `+n-m` badge SHALL remain visible in the header while the file
  rows are hidden.

#### Scenario: badge uses additive and destructive color tokens

- **WHEN** the `+n-m` badge renders
- **THEN** the `+n` portion SHALL use the success accent color
- **AND** the `-m` portion SHALL use the destructive accent color
- **AND** the badge SHALL reuse the project's `diff-counts-inline
  git-filetree-badge` visual token family for consistency with per-file
  stats.

### Requirement: Center preview toolbar and aligned body MUST converge without capability loss

Git 面板“在中间区域预览”MUST 保留既有 diff toolbar controls；当用户选择 split text
diff 时，body MUST 复用 File History 的 `WorkspaceReadOnlyDiffCompare` aligned
CodeMirror renderer。

#### Scenario: split text preview reuses the shared aligned compare

- **WHEN** 用户在 Git changed-file row 触发“在中间区域预览”
- **AND** 当前 entry 是 text diff 且 view style 为 `split`
- **THEN** toolbar MUST 继续显示双栏/单栏与全文/区域 controls
- **AND** body MUST 显示 shared previous/source CodeMirror columns
- **AND** difference navigation、gutter labels、semantic red/green tone 与 horizontal scroll MUST 保持可用

#### Scenario: toolbar mode changes still control the body

- **WHEN** 用户从 split 切换到 unified
- **THEN** body MUST 回到既有 unified patch renderer
- **WHEN** 用户在 full/focused content mode 间切换
- **THEN** toolbar 与 aligned body MUST 消费同一受控 mode，不得显示不同版本的 diff

#### Scenario: non-text and specialized surfaces retain their renderer

- **WHEN** entry 是 image、binary、PR review 或 editable modal preview
- **THEN** existing `GitDiffViewer` / editable renderer MUST remain in use
- **AND** renderer convergence MUST NOT remove annotation、editing、image compare 或 close behavior

### Requirement: Semantic Diff AI Review Is Generated On Demand Per Turn

The session activity semantic diff SHALL generate its AI review explain layer on demand when the user opens a turn's semantic diff tab, SHALL cache the result per turn, and SHALL degrade silently to deterministic rule facts when generation or parsing fails.

#### Scenario: AI review is generated when the semantic tab is opened

- **WHEN** the user opens a turn's semantic diff tab and that turn has no cached AI review
- **THEN** the client SHALL request an AI review for that turn through a lightweight hidden engine session (sessionPurpose `semantic-diff-review`)
- **AND** the request SHALL summarize the turn's changed files with bounded diff truncation
- **AND** deterministic rule facts SHALL render immediately without waiting for the AI review.

#### Scenario: AI review output is validated against the evidence contract

- **WHEN** the engine returns review output for a turn
- **THEN** the client SHALL parse it as structured JSON and validate each fact's category, confidence, text, and evidence refs
- **AND** facts whose evidence paths do not belong to the turn's changed files SHALL be dropped
- **AND** facts without any valid evidence ref SHALL be dropped
- **AND** accepted facts SHALL merge into the intent, behavior, risk, and validation zones as AI-sourced review hints that augment rather than replace deterministic facts.

#### Scenario: Generation or parse failure degrades silently

- **WHEN** the engine request fails, times out, or returns output that cannot be parsed into the review contract
- **THEN** the semantic diff SHALL render without AI facts
- **AND** the UI SHALL NOT surface an error or block interaction
- **AND** the failure SHALL be cached for that turn so the same turn is not requested repeatedly.

#### Scenario: Repeated views reuse the cached review

- **WHEN** the user revisits the semantic diff tab of a turn that already has a completed AI review attempt
- **THEN** the client SHALL reuse the cached review (including a cached empty or failed result)
- **AND** it SHALL NOT issue another engine request for that turn.

### Requirement: Semantic review cache MUST track review inputs

The turn semantic review cache MUST be scoped by workspace, turn, output language, and the normalized diff entries used to produce the review.

#### Scenario: diff content changes after an early review
- **WHEN** a semantic review completes and the same turn later exposes different diff content
- **THEN** the stale cached review MUST NOT be reused
- **AND** a new review request MUST use the latest entries

#### Scenario: output language changes
- **WHEN** the user changes the semantic review output language for the same turn and diff
- **THEN** the prior-language cache entry MUST NOT be reused

### Requirement: Semantic engine fallback MUST remain serial

The client MUST NOT start a fallback semantic review engine while a previous engine request remains active and cannot be cancelled.

#### Scenario: primary engine request remains unsettled
- **WHEN** the primary hidden engine request has not settled and exposes no cancellation contract
- **THEN** the client MUST NOT start a fallback engine based only on a frontend timer

### Requirement: Compact Vertical Action Column for Commit Composer

The diff panel commit composer SHALL place the AI message generation button and the commit button in a vertical action column on the right side of the commit message textarea, replacing the previous bottom-positioned commit button.

#### Scenario: commit button located in right action column

- **WHEN** the commit composer is visible
- **THEN** the commit button SHALL render below the AI generate button on the right side of the textarea
- **AND** the previous bottom-positioned commit button SHALL NOT be rendered

#### Scenario: commit button states

- **WHEN** there is no commit message, no selected file, or commit is in progress
- **THEN** the commit button SHALL be disabled and show an appropriate tooltip

#### Scenario: multi-repository commit composer uses same layout

- **WHEN** the commit composer is rendered for multiple repositories (`GitMultiRepositoryChanges`)
- **THEN** the AI generate button and commit button SHALL also be placed in the same right-side vertical action column
- **AND** the previous bottom-positioned commit button SHALL NOT be rendered

#### Scenario: commit execution

- **WHEN** user clicks the commit button in the right action column
- **THEN** system SHALL invoke the same `onCommit` callback with `selectedPaths` as before

### Requirement: Compact Push Entry in Diff Panel Toolbar

The diff panel SHALL provide a compact push entry in the header toolbar (same row as the mode selector and refresh button) instead of a full-width push button block above the changes list. The entry SHALL render as an upload icon with a badge showing the number of commits ahead.

#### Scenario: push entry visible with ahead commits

- **WHEN** the panel is in diff mode and `commitsAhead > 0`
- **THEN** the header toolbar SHALL show a push icon button with a badge equal to `commitsAhead`
- **AND** clicking it SHALL invoke the same push action as the previous full-width button

#### Scenario: push entry hidden when nothing to push

- **WHEN** `commitsAhead === 0` or the panel is not in diff mode
- **THEN** the push entry SHALL NOT be rendered

#### Scenario: push error remains visible

- **WHEN** a push action fails
- **THEN** the push error message SHALL still be displayed in the panel even though the full-width push block was removed

#### Scenario: push loading state

- **WHEN** a push is in progress
- **THEN** the toolbar push entry SHALL be disabled and show a loading indicator

### Requirement: Unstaged discard restores working tree to the index

Unstaged discard MUST restore only the working tree. It MUST NOT unstage or otherwise mutate the index for the same path. `revert_git_file` and `revert_git_paths` are the authoritative mutations for this action in both desktop and daemon.

#### Scenario: Mixed staged and unstaged edits on one file

- **WHEN** the same tracked file has staged changes and additional unstaged working-tree edits
- **AND** the user confirms discard from the unstaged section
- **THEN** the working tree SHALL match the index content
- **AND** the staged changes SHALL remain in the index
- **AND** the file SHALL still appear in the staged section

#### Scenario: Unstaged-only tracked edit

- **WHEN** a tracked file has only unstaged working-tree edits
- **AND** the user confirms discard from the unstaged section
- **THEN** the working tree SHALL match HEAD
- **AND** the file SHALL leave the unstaged section

#### Scenario: Untracked file discard

- **WHEN** an untracked file appears in the unstaged section
- **AND** the user confirms discard
- **THEN** the file SHALL be removed from the working tree
- **AND** the index SHALL remain unchanged

#### Scenario: Repository-wide revert all remains destructive

- **WHEN** the user confirms repository-wide revert all
- **THEN** staged changes, unstaged changes, and untracked files SHALL all be discarded
- **AND** this MUST NOT change the unstaged-section discard semantics above

