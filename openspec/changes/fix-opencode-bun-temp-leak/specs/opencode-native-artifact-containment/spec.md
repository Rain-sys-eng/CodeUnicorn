## ADDED Requirements

### Requirement: Windows OpenCode Child Artifact Containment

On Windows, every ccgui-created OpenCode CLI child process SHALL receive a child-process-only
`BUN_TMPDIR` that points to a fresh ccgui-owned run directory under the dedicated OpenCode
native-artifact root. The parent process environment and system environment variables MUST NOT
be mutated. If the private directory cannot be prepared, ccgui MUST fail that OpenCode launch
with a diagnostic error and MUST NOT fall back to system `%TEMP%`.

#### Scenario: OpenCode turn starts on Windows

- **WHEN** ccgui starts `opencode run --format json` on Windows
- **THEN** the child process SHALL inherit a fresh private `BUN_TMPDIR` run directory
- **AND** the directory SHALL be owned by ccgui rather than the system Temp root
- **AND** no global environment variable SHALL be changed

#### Scenario: OpenCode lifecycle probe starts on Windows

- **WHEN** ccgui runs an OpenCode `--version`, `--help`, or `models` probe for status, doctor, or installer lifecycle
- **THEN** that OpenCode child process SHALL use the same private `BUN_TMPDIR` policy
- **AND** non-OpenCode CLI probes SHALL remain on their existing launch path

#### Scenario: OpenCode management command starts on Windows

- **WHEN** desktop ccgui or `cc_gui_daemon` starts an OpenCode management, provider, or session command
- **THEN** that child process SHALL use the same private `BUN_TMPDIR` policy
- **AND** the lease SHALL survive until its `.output()` or spawned child lifecycle settles

### Requirement: Owned Artifact Cleanup Is Fail-Closed

ccgui SHALL delete OpenCode native artifact directories only after proving that they are direct,
non-symlink children of its dedicated root and carry the expected ownership marker. Each active
run directory SHALL be protected by an ownership lock. A failed ownership check, lock conflict,
or filesystem deletion error MUST cause cleanup to skip that directory and MUST NOT broaden the
deletion target.

#### Scenario: OpenCode child exits normally

- **WHEN** an OpenCode child process exits and its private run lease is released
- **THEN** ccgui SHALL attempt to remove only that lease's owned run directory
- **AND** ccgui SHALL leave the dedicated root and all unrelated temporary files intact

#### Scenario: Stale owned run directory is unlocked

- **WHEN** a later OpenCode launch discovers an unlocked, marked run directory under the dedicated root
- **THEN** ccgui SHALL reclaim that directory before creating a new run lease
- **AND** ccgui SHALL not recursively delete the root itself

#### Scenario: Candidate directory is locked or unproven

- **WHEN** stale cleanup finds a locked directory, symlink, missing marker, invalid marker, or non-direct child
- **THEN** ccgui SHALL skip the candidate and record a diagnostic warning
- **AND** ccgui SHALL not delete `%TEMP%`, `$TMPDIR`, updater files, or third-party files

### Requirement: Native Artifact Storage Budget

ccgui SHALL bound Windows OpenCode native artifact storage to 256 MiB for one run directory and
512 MiB for the dedicated root. ccgui SHALL sample metadata without reading artifact content no
more frequently than once per second while an OpenCode turn is active.

#### Scenario: Active child exceeds its artifact budget

- **WHEN** a running OpenCode child exceeds either the per-run or root storage limit
- **THEN** ccgui SHALL terminate that child through the existing OpenCode termination path
- **AND** the turn SHALL settle with a storage-limit diagnostic that recommends upgrading the OpenCode runtime

#### Scenario: Root remains above the storage budget

- **WHEN** stale cleanup cannot bring the dedicated root below its storage limit before a new OpenCode launch
- **THEN** ccgui SHALL reject the new OpenCode launch with a diagnostic error
- **AND** ccgui SHALL not bypass the limit by using system `%TEMP%`

### Requirement: Non-Windows Environment Preservation

On macOS and Linux, this capability SHALL preserve the inherited `BUN_TMPDIR` and `TMPDIR`
values. It MUST NOT create the Windows private native-artifact root, inject a replacement
temporary directory, scan `$TMPDIR`, or perform cleanup outside the current Windows policy.

#### Scenario: OpenCode child starts on macOS

- **WHEN** ccgui starts an OpenCode child on macOS
- **THEN** the child SHALL retain the user's inherited `BUN_TMPDIR` and `TMPDIR` values
- **AND** ccgui SHALL not create or clean a native-artifact containment directory

### Requirement: Artifact Containment Diagnostics

OpenCode diagnostics SHALL report the active platform policy, aggregate owned artifact count and
bytes where containment is enabled, configured storage limits, cleanup scope, and embedded Bun
runtime provenance status. Diagnostics MUST NOT expose absolute local paths, random artifact
filenames, prompt content, or session data. Embedded Bun provenance MUST be reported as
`unverified` unless ccgui has an independently verified provenance mapping.

#### Scenario: Doctor runs against a custom OpenCode binary

- **WHEN** the user runs OpenCode doctor with a custom executable
- **THEN** the report SHALL include artifact-containment diagnostics
- **AND** it SHALL not infer that the embedded Bun runtime is safe from the OpenCode version string alone
- **AND** it SHALL recommend upgrading the externally managed runtime when provenance is unverified
