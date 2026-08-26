## 背景

折叠态默认露出条数今天是：

```
workspace.settings.visibleThreadRootCount ?? DEFAULT_VISIBLE_THREAD_ROOT_COUNT(12)
```

入口在会话管理页，且按项目保存。用户要的是全局默认、入口在「工作区」段头，并把出厂值改成 5、可调 1..20。

## 方案

**选定：AppSettings 全局默认 + 可选 workspace 覆盖**

| Option | Summary | Trade-off |
|--------|---------|-----------|
| A 只改常量 | 12→5，无 UI | 不能自己调 |
| **B 全局默认（采用）** | `AppSettings.defaultVisibleThreadRootCount` | 对所有项目生效；旧的 workspace 覆盖仍认 |
| C 批量写回每个 workspace | 点保存就改所有项目 | 破坏已有覆盖，后续设置项也难扩展 |

### 数据

```ts
AppSettings.defaultVisibleThreadRootCount: number // default 5, clamp 1..20
WorkspaceSettings.visibleThreadRootCount?: number | null // 可选覆盖，仍 clamp 1..200
```

Resolve：

```
pageSize = workspace.visibleThreadRootCount 有有效数字
  ? clamp(workspace, 1..200)
  : clamp(appSettings.defaultVisibleThreadRootCount, 1..20) // 缺省 5
visibleCap = pageSize * page
```

「更多」仍按 `page * pageSize` 扩；first-paint fetch / Session Index `limit` 跟同一 pageSize。

### UI

```
工作区                    [全折叠] [添加项目] [设置]
```

- 设置按钮复用 `.sidebar-title-add`，lucide `Settings`。
- 弹窗：不透明 Dialog，preference row：标题 + 说明 + number input。
- 失焦 / 合法变更即 `queueSaveSettings`，不另做「保存」主按钮。
- 样式用小切片，不整包加载 `settings.css`。

### 兼容

- 已显式保存过 `visibleThreadRootCount` 的项目不跟全局，避免静默改用户旧值。
- 会话管理页仍可改单项目覆盖；文案标明这是覆盖，默认来自工作区设置。
- Rust / TS deserialize 缺字段 → 5。

## 风险

- 旧测试把 12 写死：常量、Index limit、catalog first-paint 一并改。
- 全局 1..20 与 workspace 覆盖 1..200 不要混 clamp。
- 弹窗打开不得把设置页整包 CSS 打进侧栏热路径。
