## MODIFIED Requirements

### Requirement: Shared Engine Exclusion Includes Qoder

`qoder` SHALL NOT be added to `SHARED_SESSION_SUPPORTED_ENGINES` or
`is_supported_shared_session_engine()`. The Shared target picker SHALL show
Qoder disabled with an explicit reason, and
`normalizeSharedSessionEngine("qoder")` SHALL fail closed to the default
engine. Persist / resolve paths SHALL reject a `qoder` Shared target instead
of writing a Qoder binding.

#### Scenario: Shared picker shows Qoder disabled

- **WHEN** the user opens Shared target selection
- **THEN** Qoder SHALL be unavailable with a visible reason
- **AND** SHALL NOT be silently hidden from the list

#### Scenario: Exhaustive matches fail closed

- **WHEN** shared session runtime code matches on engine type
- **THEN** the `qoder` arm SHALL be an explicit fail-closed branch
- **AND** SHALL NOT fall through to a default engine binding
