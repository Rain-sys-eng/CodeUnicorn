# Spec delta: client-startup-orchestration

> OpenSpec change: `defer-thread-list-hydration-until-idle-or-intent`

## MODIFIED Requirements

### Requirement: Cold-start thread list MUST NOT auto-start immediately on active bind

Cold-start（含 activeWorkspaceId 首次 bind 与 workspacesById 晚到后的首次可 ensure）MUST NOT 在 mount 后短定时（例如 ≤500ms）自动启动 `listThreadsForWorkspace` / first-paint IPC。  
系统 MUST 使用 **idle 调度**（`requestIdleCallback` 或等价，带 minDelay 与 timeout 天花板）在空闲后对 **当前 active workspace** 启动有界 first-paint。  
显式 force / Load older / Session Management ensure MUST 仍可立即启动。

#### Scenario: cold start does not fire list in the first seconds without intent

- **WHEN** app cold-starts with an active workspace that exists in `workspacesById`
- **AND** the user has not switched workspace
- **THEN** first-paint list MUST NOT start in the same tick / sub-second auto timer as shell bind
- **AND** an idle-or-ceiling scheduler MUST eventually start exactly one first-paint for that active workspace (unless cancelled by later switch)

#### Scenario: home without active does not auto-list

- **WHEN** there is no `activeWorkspaceId`
- **THEN** automatic thread-list first-paint MUST NOT run for any workspace

### Requirement: Interaction MUST remain available while deferred list is pending

While automatic first-paint is deferred or in-flight, the shell MUST remain interactive for settings, workspace switch, and composer focus. List loading indicators MAY show on the sidebar list region only; they MUST NOT imply a full-window modal lock as the product default path.

#### Scenario: settings openable during deferred hydration

- **WHEN** cold-start idle first-paint has not completed
- **THEN** the user MUST be able to open Settings without requiring list completion as a gate
