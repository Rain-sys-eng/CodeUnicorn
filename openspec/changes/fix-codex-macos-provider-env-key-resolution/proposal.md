# fix(codex): 补齐 macOS GUI 启动时的 provider 环境变量

## Why

从 Finder/Dock 启动 ccgui 时，GUI 进程通常没有继承交互式 shell 的环境变量。Codex config 若通过 `model_providers.*.env_key` 引用密钥，就会出现 `Missing environment variable`，导致会话启动失败或只留下用户消息。

## Scope

- 在启动 Codex app-server 前解析 effective `CODEX_HOME/config.toml`。
- 支持任意合法环境变量名，不 hardcode `OPENAI_API_KEY`。
- 优先保留已继承的非空值；缺失值通过 allowlisted login/interactive shell 获取。
- 只向 Codex child process 注入值，不修改配置文件、不输出 secret。

## Out of scope

- 自动写入用户 shell 配置。
- 改变 provider binding、model catalog 或 Codex history contract。
