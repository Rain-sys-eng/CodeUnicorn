## ADDED Requirements

### Requirement: Relationship snapshot reads MAY request sections

`project_map_relationship_read` SHALL accept an optional `include` list of section names. When `include` is omitted, the command SHALL return the same artifact fields as the previous full-read contract. When `include` is present, the command SHALL serialize only the requested sections. Unknown section names SHALL be ignored. The command MUST NOT rewrite snapshot files on the read path.

#### Scenario: Legacy client omits include

- **WHEN** a client calls `project_map_relationship_read` without `include`
- **THEN** the response includes the existing full set of optional artifact fields

#### Scenario: Search Radar requests a slim payload

- **WHEN** a client requests `include: ["manifest", "apiContracts", "stale"]`
- **THEN** the IPC payload omits `relations` and does not include a full v1 `repair.issues` array

### Requirement: Repair artifacts stay bounded on the wire

When a repair artifact is returned, the backend SHALL cap v1 `issues[]` into `issueCount`, `byKind`, and at most 20 samples per kind, and mark `truncated` when samples are incomplete. A compact schemaVersion>=2 artifact SHALL be returned as stored. The backend MUST NOT write the capped view back to disk during read.

#### Scenario: Legacy 35MB repair file is opened

- **WHEN** `repair/latest.json` contains tens of thousands of v1 issues
- **THEN** the returned repair object is a compact summary and the on-disk file is unchanged

### Requirement: Search Radar MUST NOT auto-scan the workspace

Opening Search Radar, including the APIs content filter, MUST NOT call `project_map_relationship_scan`. A stale snapshot SHALL keep the last endpoints searchable and expose a stale status. A missing snapshot SHALL show an empty API index and MUST NOT start a scan.

#### Scenario: Stale API snapshot while searching

- **WHEN** the user opens Search Radar with APIs enabled and the relationship snapshot is stale
- **THEN** previous endpoints remain searchable and no relationship scan starts

#### Scenario: No API snapshot exists

- **WHEN** the user opens Search Radar with APIs enabled and no relationship snapshot exists
- **THEN** the API index is empty and no relationship scan starts

### Requirement: New scans write compact repair and treat backups as cache

A new relationship scan SHALL persist compact repair (schemaVersion 2, counts plus samples). Duplicate-relation events SHALL increment counts and MUST NOT persist one issue row per duplicate. The scan SHALL NOT create a full relations/repair backup by default. After a successful write, the backend MAY delete expired directories that strictly match `backups/backup-<UTC timestamp>`, keeping the newest two or a 200MB budget. Current `latest` artifacts MUST NOT be deleted by this cleanup. Startup MUST NOT delete backups.

#### Scenario: Repeated scans stop growing 70MB copies

- **WHEN** a user runs a new relationship scan
- **THEN** the write does not copy `relations/latest.json` into a new backup by default and expired timestamped backup directories may be removed
