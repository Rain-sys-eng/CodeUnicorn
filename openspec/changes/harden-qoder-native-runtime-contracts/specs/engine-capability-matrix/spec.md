## ADDED Requirements

### Requirement: Supported Qoder capability cells MUST represent a product route

For Qoder, a `supported` capability matrix cell MUST have both reproducible vendor evidence and a mossx Native product route with regression coverage. Vendor-only evidence MUST be documented as deferred rather than marked product-supported.

#### Scenario: Qoder fork remains supported only with an exposed route

- **WHEN** the matrix reports `qoder` / `session.fork` as `supported`
- **THEN** a Native Qoder fork request MUST route to ACP `session/fork`
- **AND** focused regression coverage MUST assert the route and child session identity

#### Scenario: Qoder usage evidence is not represented as product support until projected

- **WHEN** Qoder prompt result usage fields are observed from the vendor
- **THEN** the matrix and calibration documents MUST distinguish raw evidence from a completed product capability
- **AND** after `UsageUpdate` projection is implemented, the documents MUST cite the runtime mapping and regression coverage
