## MODIFIED Requirements

### Requirement: Registry MUST Support Typed Built-Ins And Extensible Engine Identities

Built-in engines MUST retain exhaustive Rust typing while registry APIs use a stable opaque `EngineId` capable of representing validated external registrations.

#### Scenario: built-in engine is registered

- **WHEN** the registry initializes a built-in adapter
- **THEN** its TypeScript、Rust and daemon identity MUST pass parity validation

#### Scenario: external engine is registered

- **WHEN** a future trusted plugin registers an external engine
- **THEN** registration MUST validate schema、source and capabilities
- **AND** it MUST NOT require adding a variant to the built-in enum

#### Scenario: ACP stdio protocol family is registered

- **WHEN** the builtin `qoder` entry is reported
- **THEN** `EngineProtocolFamily` SHALL include `acp-stdio` in TypeScript and Rust
- **AND** `BuiltinEngineProtocol::family()` SHALL route `qoder` to `acp-stdio`
- **AND** the registry parity gate SHALL expect `builtin.qoder`
