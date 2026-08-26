## ADDED Requirements

### Requirement: Custom llm-pi-ai routes admit images without hand-editing DSH settings

When a DSH turn includes image parts and the selected model is served by a writable `llm-pi-ai` provider route that has not declared image input, mossx MUST declare `[text, image]` through Host RPC `settings.mutate` before `session.prompt`. mossx MUST NOT require the user to edit `$DSH_HOME/settings.yaml` or open the DSH Web UI for this declaration.

mossx MUST NOT invent a missing provider profile, MUST NOT write credentials /
baseURL / api, and MUST NOT rewrite a non-`llm-pi-ai` adapter such as
`llm-deepseek`.

#### Scenario: Hand-declared grok route has no image modalities

- **WHEN** the user sends an image on a DSH thread whose current model is a
  custom `llm-pi-ai` route such as `grok/grok-4.6`
- **AND** that route's model entry and `defaultInput` do not include `image`
- **AND** `settings.describe` reports the host writable
- **THEN** mossx SHALL call `settings.mutate` on `llm-pi-ai` to set
  `defaultInput` or that model entry's `input` to `[text, image]`
- **AND** mossx SHALL then call `session.prompt` with the image parts
- **AND** mossx SHALL NOT tell the user to edit DSH settings as the primary path

#### Scenario: Modalities already include image

- **WHEN** the selected `llm-pi-ai` model already declares `image` on the
  model entry or the route `defaultInput` covers an undescribed model
- **THEN** mossx SHALL NOT call `settings.mutate`
- **AND** mossx SHALL send `session.prompt` unchanged

#### Scenario: Official DeepSeek adapter stays text-only

- **WHEN** the selected provider is owned by a namespace other than `llm-pi-ai`
- **THEN** mossx SHALL NOT mutate DSH settings
- **AND** image admission SHALL remain the adapter's own declaration

#### Scenario: Settings cannot be written

- **WHEN** the host is read-only, the route has no `llm-pi-ai` profile, or
  `settings.mutate` is rejected
- **THEN** mossx SHALL fail closed before `session.prompt`
- **AND** the error SHALL explain that mossx could not declare image input
- **AND** the error MAY point at opening DSH Settings only as recovery
