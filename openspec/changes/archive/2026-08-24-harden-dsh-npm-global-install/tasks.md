# Tasks: harden-dsh-npm-global-install

- [x] 1. DSH install/update command preview 与 `resolve_installer_command` 共用 hardened npm args
- [x] 2. 安装前清理 stale `@deepseek-ai/dsh` 全局目录；extract-race 失败后强制清理并重试一次
- [x] 3. DSH timeout 420s；失败文案点明 ENOENT / corrupted tarball
- [x] 4. 补 command / race / path / plan 单测
- [x] 5. `cargo test -p cc-gui --lib installer`（23 passed）
