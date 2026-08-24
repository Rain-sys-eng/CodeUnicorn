# Spec delta: runtime-workspace-switch-hydration

> OpenSpec change: `defer-thread-list-hydration-until-idle-or-intent`

## MODIFIED Requirements

### Requirement: Workspace switch is intent-triggered first-paint with cancel

When `activeWorkspaceId` changes from workspace A to B（A 非空且 A≠B），the system MUST treat this as **user intent**：

1. Soft-cancel in-flight list tasks for A（`stale` / `isStale`）  
2. Schedule first-paint ensure for B on a **short intent delay**（not the long cold-start idle window）  
3. MUST NOT leave A’s setThreads able to overwrite B after cancel  

Navigation MUST continue to use local topology for owner ids and MUST NOT reintroduce `get_workspace_session_projection_summary(limit=9999)` on the switch hot path.

#### Scenario: switch A to B cancels A and paints B

- **WHEN** the user switches active workspace from A to B
- **THEN** orchestrator tasks scoped to A MUST be cancelled as stale
- **AND** a first-paint list for B MUST be scheduled via the intent path（short delay）
- **AND** late apply from A MUST no-op

#### Scenario: rapid switch A to B to C keeps only C

- **WHEN** the user rapidly switches A → B → C before list settles
- **THEN** only C’s first-paint apply MAY publish threads for the active list
- **AND** A and B applies MUST be discarded as stale

### Requirement: Loading list MUST NOT freeze the whole window on switch

During workspace-switch first-paint, global pointer interaction outside the list loading affordance MUST remain possible. A full-window interaction shield is NOT an acceptable product default for this path.

#### Scenario: switch shows loading without whole-app lock

- **WHEN** first-paint for the new workspace is in flight
- **THEN** the UI MAY show list loading for that workspace
- **AND** MUST NOT require list completion before the user can switch again or open Settings
