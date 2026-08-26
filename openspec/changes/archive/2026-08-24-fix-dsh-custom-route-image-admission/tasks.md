# fix-dsh-custom-route-image-admission tasks

- [x] 1. OpenSpec proposal / design / spec delta
- [x] 2. `image_admission.rs`：从 settings.describe + llm.providers 规划最小 mutate ops
- [x] 3. `send_user_turn` 附图路径在 `session.prompt` 前 ensure
- [x] 4. 更新 `MODEL_DOES_NOT_SUPPORT_IMAGES` 文案，不再教用户手改 yaml
- [x] 5. Rust 单测：no-op / defaultInput / model input / 非 pi-ai / 无路由 / 只读
