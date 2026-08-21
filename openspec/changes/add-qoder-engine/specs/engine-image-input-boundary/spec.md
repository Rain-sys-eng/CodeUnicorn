## MODIFIED Requirements

### Requirement: Qoder image transport via ACP content blocks

The runtime MUST send Qoder image attachments as ACP `session/prompt` content
blocks: one `text` block preserving the non-empty user prompt verbatim, plus
one `{ "type": "image", "mimeType": "<mime>", "data": "<base64>" }` block per
successfully loaded attachment. Unreadable attachments MUST fail the send
before spawn with a clear per-attachment error; the error MUST NOT include raw
base64 payloads. Text-only turns MUST send a single text block.

#### Scenario: Qoder turn with local image

- **WHEN** a Qoder send includes a readable local image path
- **THEN** the prompt array MUST contain an ACP `image` block with base64 data
- **AND** non-empty user text MUST be preserved verbatim in the `text` block

#### Scenario: Qoder image load failure is explicit

- **WHEN** all attached image paths are unreadable
- **THEN** the send MUST fail before spawning the ACP process
- **AND** the error MUST identify the attachment without embedding image bytes
