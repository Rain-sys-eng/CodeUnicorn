## ADDED Requirements

### Requirement: Live Settlement MUST NOT Freeze Assistant Body at a Streamed Prefix

After completed settlement, with the session still open, the visible durable assistant body MUST match the complete streamed body on both Native and Shared threads. The system MUST NOT leave the live bubble frozen at a first-token shell (e.g. a short prefix) while history hydrate shows the full text.

#### Scenario: normalized-route terminal freeze is repaired without history reload

- **WHEN** a codex-native or Shared thread streams a final assistant segment whose last deltas arrive within the terminal batching window
- **AND** turn completion installs the terminal barrier
- **THEN** the durable assistant body after settlement MUST equal the full streamed text
- **AND** the user MUST NOT need to reopen history to see the complete body

#### Scenario: late completion salvage keeps live and history parity

- **WHEN** a `completeAgentMessage` with the full body arrives after the terminal barrier (cross-channel reorder)
- **THEN** the live durable item MUST converge to the full body
- **AND** history hydrate MUST NOT be required as the only repair

#### Scenario: salvage does not create a second assistant row

- **WHEN** a late complete body is salvaged onto an existing assistant item
- **THEN** visible assistant cardinality for that response MUST remain one
- **AND** history reconcile MUST NOT be required to remove duplicate prose
