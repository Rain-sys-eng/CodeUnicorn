## 1. 契约与类型

- [x] 1.1 在 `src/types` 新增 `DirectoryGrantRequest` / `DirectoryGrantDecision` / `DirectoryGrantScope`（once|session|workspace）及 `retryContext` 字段；从 types 入口 re-export
- [x] 1.2 在 Rust `EngineEvent`（或稳定 Raw type）增加 DirectoryGrant 请求/决策透出；对齐 serde 命名
- [x] 1.3 运行 `npm run check:runtime-contracts` 与 `npm run typecheck` 对齐前后端契约

## 2. 路径 canonical 与 L1 状态

- [x] 2.1 实现 OS 感知 path canonical 模块（Win 盘符/分隔符、Linux 大小写敏感、mac 不敏感；symlink 解析；失败 fail-closed）
- [x] 2.2 实现 session L1 allowlist 状态（cwd + 启动 add-dir + runtime grants）；`workspace` scope 持久化钩子
- [x] 2.3 添加 Rust 路径矩阵单测（mac/win/linux 用例 + symlink 逃逸拒绝）

## 3. Claude 越界合成与引擎映射

- [x] 3.1 验证 Claude CLI `--add-dir` 热扩可行性；结论回写 `design.md` Open Questions
- [x] 3.2 在 `event_conversion` / `approval` 中识别 outside-L1 + 可解析 path → 合成 DirectoryGrant（优先于裸 modeBlocked）
- [x] 3.3 实现 grant accept → 注入 add-dir / 更新 L1 → 自动重试；不可热扩时下一 turn 生效 + 诚实文案
- [x] 3.4 Host path gate 读路径与 L1 对齐；写路径仍走 L2 + workspace apply gate
- [x] 3.5 添加 Claude 越界 → grant → accept/decline 的 Rust 单测

## 4. 前端方案 A 内联卡

- [x] 4.1 `useAppServerEvents`（或等价路由）消费 DirectoryGrant 事件并入队
- [x] 4.2 实现内联 DirectoryGrant 卡片：路径展示、scope 三选（默认 session）、允许/拒绝、敏感根强提示、macOS L3 可选提示
- [x] 4.3 thread scoping：仅活动 thread 显示；无 threadId 走 workspace fallback
- [x] 4.4 允许/拒绝决策 IPC + 拒绝诊断文案 + 自动重试结果展示
- [x] 4.5 i18n（至少 en/zh）新增 key
- [x] 4.6 vitest：卡片交互、scope 默认、thread 隔离、拒绝 fail-closed

## 5. 验证与收口

- [x] 5.1 `openspec validate session-directory-grant --strict --no-interactive`
- [x] 5.2 `npm run lint && npm run typecheck && npm run test`（至少触及目录相关测试）
- [x] 5.3 `cargo test --manifest-path src-tauri/Cargo.toml`（path + grant 相关）
- [x] 5.4 `npm run check:runtime-contracts`
- [x] 5.5 中文 Conventional Commit + 按 AGENTS.md 执行 post-commit session record（若环境要求）

## 已知后续（非阻塞 #1062 主路径）

- `workspace` scope 持久化到 disk / 新会话注入：当前仅写入 session L1 内存
- `once` 真正用完即删
- 同进程热扩 Claude allowed dirs（CLI 无稳定 API 时维持 next-launch `--add-dir`）
- 方案 B 侧栏 allowlist 管理 UI
