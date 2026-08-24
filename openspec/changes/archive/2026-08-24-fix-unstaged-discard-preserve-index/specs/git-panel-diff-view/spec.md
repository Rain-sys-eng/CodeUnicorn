## ADDED Requirements

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
