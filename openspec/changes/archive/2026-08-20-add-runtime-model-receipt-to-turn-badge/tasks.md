# Tasks: add-runtime-model-receipt-to-turn-badge

> 范围：Shared-only。Native CLI session 关闭 badge / 回执。
> 不改 picker send 权威。不覆盖 snapshot.model。

## 1. P0 合同收口

- [x] 1.1 OpenSpec 改为 Shared-only：Native MUST NOT 渲染 badge / 回执。
- [x] 1.2 Shared 仍发送即种 `send.request`，stream 升级 receipt。

## 2. P0 关闭 Native 写入

- [x] 2.1 Native send 去掉 snapshot / receipt。
- [x] 2.2 Native 事件 attach / fail path / pending rename 去掉 native store。
- [x] 2.3 Native history parser / curtain snapshot / threadItems 去掉 stamp。
- [x] 2.4 capture / token window 只处理 Shared thread id。

## 3. P0 Shared UI 保持

- [x] 3.1 MessageRow 同行 `→` + 下滑出处（仅 Shared 有 snapshot 时出现）。
- [x] 3.2 Shared 侧栏 / 顶栏不去橘色。

## 4. 验证

- [x] 4.1 focused vitest + `openspec validate ... --strict`。
- [x] 4.2 碰撞测试覆盖 Native 无 stamp、Shared send/live/complete 升级、live 窗口不被 init 覆盖；手测项由用户收口提交。
