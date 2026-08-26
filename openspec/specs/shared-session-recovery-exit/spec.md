# shared-session-recovery-exit Specification

## Purpose
TBD - created by archiving change fix-shared-session-recovery-exit-closure. Update Purpose after archive.
## Requirements
### Requirement: Recovery Exit Ladder MUST Be Completable

The system MUST provide a completable recovery exit ladder for Shared Session `recovery-required` without automatic blind retry. Users MUST be able to complete recovery in a finite number of explicit actions via Probe, Stop delivery, Stop-and-rebuild binding, and durable Abandon turn.

#### Scenario: stop-and-rebuild while runtime owns attempt

- **WHEN** the session is `recovery-required` and Runtime still owns the unresolved attempt
- **THEN** choosing Stop-and-rebuild MUST attempt interrupt before rebuild
- **AND** on success the UI MUST unlock only through `settling` then `idle` (or reattach `running`)
- **AND** the system MUST NOT leave the user in an infinite rebuild toast loop with no alternative action

#### Scenario: rebuild refused while still owned

- **WHEN** rebuild is requested and Runtime still owns the attempt after best-effort stop
- **THEN** the system MUST keep `recovery-required`
- **AND** the user-visible error MUST explain that stop is still required or abandon is available
- **AND** the error MUST NOT be only an opaque internal `recovery-active` string without next-step guidance

#### Scenario: durable abandon unlocks session

- **WHEN** the user confirms Abandon for a unique unresolved attempt
- **THEN** the system MUST commit durable cancelled/not-accepted terminal evidence for that attempt
- **AND** the composer MUST leave recovery only via settling→idle
- **AND** after app restart the same attempt MUST NOT resurrect `recovery-required` solely because it was abandoned

#### Scenario: abandon refused when multi-owner ambiguous

- **WHEN** more than one unresolved attempt/binding owner exists
- **THEN** Abandon MUST fail closed with an ambiguous-owner error
- **AND** the session MUST remain locked

### Requirement: Late Evidence After Exit MUST Be Absorbed

After Abandon or Rebuild has durable-settled an attempt, late ACK or late terminal evidence for that attempt MUST NOT create a second commit, MUST NOT re-lock the same attempt into a new recovery cycle as if it were a fresh send, and MUST NOT write live turn state into a replaced binding generation.

#### Scenario: late terminal after abandon

- **WHEN** a late terminal arrives for an already abandoned attempt
- **THEN** the system MUST treat it as stale/absorbed evidence
- **AND** MUST NOT produce a contradictory second terminal commit for a new live turn

### Requirement: Recovery UI Actions MUST Match Disposition

The recovery status bar MUST present a simplified default surface when the exit ladder is enabled: primary Auto-handle and Skip-turn actions, with Probe / Stop / Rebuild available as advanced or as steps inside Auto-handle. Stop and Abandon capabilities MUST remain reachable; Abandon is presented as Skip-turn. Action enablement MUST still respect owner kind (attempt vs binding) and MUST NOT enable Stop when there is no interruptible in-flight attempt.

#### Scenario: default surface does not require four equal buttons

- **WHEN** disposition requires recovery and exit ladder is enabled
- **THEN** the default (collapsed) UI MUST NOT require the user to choose among four peer engineering buttons
- **AND** Auto-handle or Skip-turn MUST be sufficient to complete a normal exit path

#### Scenario: active disposition still supports stop before rebuild

- **WHEN** disposition is active (accepted and Runtime-owned)
- **THEN** Auto-handle MUST attempt stop before rebuild when needed
- **AND** advanced Stop / Rebuild controls MAY remain available after expand

#### Scenario: interrupt capability missing

- **WHEN** the engine cannot interrupt the owned attempt
- **THEN** the UI MUST NOT pretend Stop succeeded
- **AND** Skip-turn (durable abandon) MUST remain the primary explicit exit with a clear confirmation

### Requirement: Recovery Errors MUST Be Actionable

User-facing recovery errors MUST state why the session is locked and which explicit action to take next. Technical identifiers (attemptId, bindingKey, raw codes) MAY be shown as secondary detail.

#### Scenario: recovery-active mapping

- **WHEN** backend returns `recovery-active` / `recovery-active-requires-stop`
- **THEN** the toast or status text MUST map to localized stop-before-rebuild or abandon guidance

### Requirement: Recovery confirmations MUST be application dialogs

Any confirmation required before durable Abandon / Skip-turn MUST use an in-app dialog component. The recovery UI MUST NOT call `window.confirm` or host-native blocking confirm APIs for this path.

#### Scenario: abandon path without window.confirm

- **WHEN** the user initiates Skip-turn / Abandon from the recovery bar
- **THEN** confirmation MUST be rendered by the application UI toolkit
- **AND** canceling the dialog MUST not invoke abandon

