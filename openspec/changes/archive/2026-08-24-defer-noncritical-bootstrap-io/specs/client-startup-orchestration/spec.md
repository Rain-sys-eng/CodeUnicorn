## MODIFIED Requirements

### Requirement: Renderer Bootstrap MUST Separate Critical And Post-Render Work

renderer bootstrap path MUST 区分 first shell render 必需 work、可并行 work、以及 shell mount 后执行的 post-render work。

#### Scenario: non-critical input history does not block first render

- **WHEN** app starts and composer input history is not required to render initial composer
- **THEN** input history restore MUST NOT block root render
- **AND** composer MUST remain usable before history hydration completes
- **AND** history navigation MUST become available after hydration settles

#### Scenario: best-effort migration does not block shell when safe

- **WHEN** localStorage migration is not required for initial shell correctness
- **THEN** migration SHOULD run after root render or in a non-blocking background phase
- **AND** migration failure MUST be recorded as bounded diagnostics instead of preventing shell render
- **AND** any migration proven critical MUST document the invariant that requires blocking

#### Scenario: app import and current locale load run in parallel where safe

- **WHEN** bootstrap starts
- **THEN** `import("./App")`, critical store preload, and current-locale **critical** i18n loading SHOULD begin without unnecessary serial waits
- **AND** root render MUST wait only for the critical subset needed to render shell correctly

#### Scenario: non-critical client stores do not block first paint

- **WHEN** bootstrap starts
- **THEN** root render MUST wait only for `layout` and `app` client stores
- **AND** `threads`, `diagnostics`, `leida`, and `composer` MUST NOT be required before first shell render
- **AND** those deferred stores SHOULD hydrate after mount via idle time or first user interaction
- **AND** a write that landed in memory before deferred hydrate MUST win over the disk snapshot for dirty keys

#### Scenario: full locale pack does not block first paint

- **WHEN** bootstrap starts with a stored or default locale
- **THEN** root render MUST wait only for that locale's critical resource pack
- **AND** deferred locale resources MUST NOT block first shell render
- **AND** `i18nReady` MAY still represent the full pack for tests and post-mount consumers
- **AND** a language switch after startup MUST still load the target locale's full pack before the visible language change commits
