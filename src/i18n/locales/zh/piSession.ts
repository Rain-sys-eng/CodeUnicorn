export default {
  piSession: {
    fork: {
      title: "从这条消息分叉",
      description:
        "将回到该消息之前的点创建新会话文件：以该消息为草稿重写，源会话保持不动。新分支出现在会话树面板（不占侧栏），创建后自动跳转继续。",
      cancel: "取消",
      confirm: "创建分叉",
      confirming: "分叉中…",
      successTitle: "✓ 分叉已创建",
      successBody:
        "新分支已出现在右侧会话树面板，源消息已填入它的输入框草稿，跳转即可继续。",
      errorEntryNotFound:
        "无法在 pi 会话中定位这条消息（可能已被压缩）。",
      errorEntryNotForkable:
        "这条消息不在当前会话文件里——它属于会话树中的另一条分支（或已被压缩），不能从这里直接分叉。请先在会话树中「↪ 跳转」到这条消息所在的分支，再对它分叉。",
    },
    compact: {
      entryTitle: "压缩上下文（pi RPC: compact）",
      entryLabel: "压缩",
      dialogTitle: "压缩上下文",
      dialogAria: "压缩上下文",
      occupancy: "当前上下文占用",
      messages: "会话消息",
      tokens: "上下文 tokens",
      instructionsLabel: "压缩指令（可选）",
      instructionsPlaceholder: "例如：保留根因结论与文件清单，压缩试错过程",
      hint: "压缩是有损的：完整历史保留在 pi 会话文件中，可在会话树中回溯。",
      cancel: "取消",
      close: "关闭",
      confirm: "压缩上下文",
      confirming: "压缩中…",
      tooShort:
        "会话还很短，没有可压缩的内容（pi 会完整保留最近约 20k tokens）。",
      done: "压缩完成：{{before}} → {{after}}（估算）。",
    },
    tree: {
      panelAria: "会话树",
      badge: "PI 会话树",
      resizeAria: "调整会话树面板宽度",
      chipTitle:
        "会话分支（{{count}} 条 lane）· 点击查看会话树（pi RPC 无 lane 切换命令）",
      sidebarBadgeTitle: "会话树含 {{count}} 条分支 · 点击查看",
    },
  },
};
