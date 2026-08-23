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
  },
};
