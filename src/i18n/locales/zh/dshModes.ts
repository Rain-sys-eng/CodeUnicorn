// dshModes — Simplified Chinese UI strings
const dshModes = {
  dshModes: {
    default: {
      label: "默认模式",
      tooltip: "可写工作区；升到全盘访问仍要审批。",
      description:
        "对应 DSH 的 workspace-write。可以改当前项目，但 pwsh/bash 若要升到 danger-full-access，仍会弹出审批卡。",
    },
    plan: {
      label: "规划模式",
      tooltip: "DSH 目前未在 mossx 暴露 plan 权限档。",
      description: "本版本不对 DeepSeek Harness 开放。",
    },
    acceptEdits: {
      label: "代理模式",
      tooltip: "DSH 没有单独的自动编辑权限档。",
      description: "本版本不对 DeepSeek Harness 开放。",
    },
    bypassPermissions: {
      label: "自动模式",
      tooltip: "把当前 DSH 会话切到 danger-full-access。",
      description:
        "本会话文件和 Shell 不再受 sandbox 限制，也不会再为升级弹审批卡。请谨慎使用。",
    },
  },
};

export default dshModes;
