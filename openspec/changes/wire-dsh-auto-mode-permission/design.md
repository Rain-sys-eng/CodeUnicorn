# wire-dsh-auto-mode-permission design

## 合同

DSH host permission 是独立于 Agent Preset 的 session 旋钮。官方两档：

| mossx ModeSelect | accessMode | DSH preset | sandbox | approval |
|---|---|---|---|---|
| 默认模式 | `default` / `current` / `read-only` | `workspace-write` | `workspace-write` | `ask` |
| 自动模式 | `full-access` | `danger-full-access` | `danger-full-access` | `never` |

为什么自动模式必须切 preset，而不是 `approval: never` 单独开：

- DSH `never` 会在升级审批处 **直接拒绝**，不是放行。
- 只有 session 已经处于 `danger-full-access`，模型才不需要 `sandbox_permissions`，审批卡才不会出现。

写路径用 host 已有 slash command，不发明新 RPC：

| 时机 | RPC | 说明 |
|---|---|---|
| create 之后、prompt 之前 | `POST /api/commands/execute` | payload `{ args: { agentId, line } }`，`line = "/permission danger-full-access"` 或 `"/permission workspace-write"` |
| 续聊同一 session（idle） | 同上，prompt 前 | host `set()` 对已是目标 preset 的 session 是 no-op |
| 续聊同一 session（turn 仍开着） | **跳过** `/permission` | slash command 会 inject 进 live agent inbox，不能在 in-flight tools 下面改 ask/never |
| Settings defaultPreset | 不写 | Web Full access 要额外确认；mossx 只改当前 session |

`commands/execute` 是 Typert Gateway 拦截器，不是 `session.*` apiproxy。envelope 仍走 mossx 现有 `client-request`：

```json
{
  "type": "client-request",
  "rpcId": "...",
  "method": "commands/execute",
  "payload": {
    "args": {
      "agentId": "session-...",
      "line": "/permission danger-full-access"
    }
  }
}
```

成功 `value.result.kind === "success"`。未知 preset / 未挂 permission 插件按现有 send 错误 toast。已是目标档时 host 仍回 success。

## UI

DSH 的 ModeSelect 不再走「非 Claude 只开放自动模式」的兜底。开放：

- `default`：默认模式（workspace-write + 升级要批）
- `bypassPermissions`：自动模式（danger-full-access，无升级卡）

`plan` / `acceptEdits` 对 DSH 保持 disabled。文案走 `dshModes.*`，不要复用 Claude「全自动」或通用「绕过所有权限检查」——DSH 自动模式的准确语义是切到 full-access preset，不是 mossx 替用户点批准。

Agent Preset pill 继续独立存在；两者正交。

## 数据流

```text
ModeSelect(bypassPermissions)
  → permissionModeToAccessMode = full-access
  → engine_send_message(accessMode)
  → send_user_turn(..., access_mode)
  → session.create / resume
  → commands/execute("/permission danger-full-access")
  → session.prompt
```

create 时 host 仍会 pin 部署默认（通常 `workspace-write`）。mossx 必须在 prompt 前覆盖，否则首轮工具就会按 ask 跑。空白 DSH 会话恢复 accessMode 时不要跟全局 `full-access`：没有显式自动模式 pin 就落 `default`（workspace-write）。queued / in-flight 续聊跳过 preset 切换，等下一轮 idle prompt 再对齐。

## 失败闭合

- `commands/execute` 失败：本轮 send 失败，不要默默 prompt。否则 UI 显示自动模式，host 仍是 ask。
- 非 `full-access`：显式切回 `workspace-write`，避免上一轮自动模式残留。
- `question/requested`：继续走现有问答卡，自动模式不代答。

## 测试

- Rust：accessMode → command line 映射；payload 带 `args.agentId` + `args.line`。
- Frontend：DSH 可选 default / auto；plan / acceptEdits disabled。
