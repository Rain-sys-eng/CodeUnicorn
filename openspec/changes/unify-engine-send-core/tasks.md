# unify-engine-send-core · tasks

## 0. Gate 前置

- [ ] 0.1 读基石设计 `docs/research/mossx-multi-cli-provider-session-foundation-design.md` §3.1 / §3.5 与 onboarding 矩阵 `docs/research/mossx-new-cli-onboarding-guide.md` §0
- [ ] 0.2 完成 design §2 双侧差异审计（每引擎三类清单 + 裁决表初稿）

## 1. 脚手架（单 PR，不迁移引擎）

- [ ] 1.1 建 `engine/send_core/` module 与 `SendRuntimeAccess` 抽象（形态按 design §1 定稿）
- [ ] 1.2 GUI / daemon 双 target 编译零 error；两侧薄壳接线但仍全量走旧路径
- [ ] 1.3 迁移期路由表落地（全部 fall through）

## 2. 首引擎打样（Kimi 或 Grok）

- [ ] 2.1 平移该引擎分支进 send core；两侧旧分支改走 core
- [ ] 2.2 验收矩阵（design §4）全绿；沉淀迁移模板 checklist
- [ ] 2.3 手测：GUI + daemon 发消息 / 流式 / Stop / 续聊

## 3. 逐引擎迁移（每引擎一 PR，均按 2.x 模板）

- [ ] 3.1 OpenCode
- [ ] 3.2 Gemini
- [ ] 3.3 Pi
- [ ] 3.4 Qoder
- [ ] 3.5 Codex
- [ ] 3.6 Claude（最后：分支最重，含 shared 观测面）

## 4. 收口

- [ ] 4.1 删除两侧旧分支与迁移期路由；薄壳各 ≤300 行；`check:large-files:ci` 无新增超标
- [ ] 4.2 Engine Onboarding 矩阵逐层核对（⚠ 项全部人工勾）
- [ ] 4.3 回写基石文档「最近校准」（engine registry / terminal contract 行，附代码事实源）
- [ ] 4.4 `openspec validate --strict` + sync `engine-send-core` spec + archive
