// reasoning — Simplified Chinese UI strings
// Labels include English effort names so users can map to API/product terms (Low/Medium/High/…).
const reasoning = {
  reasoning: {
    title: "选择思考深度",
    default: "默认 (Default)",
    claudeDefault: "默认 (Default)",
    grokDefault: "默认 (Default)",
    defaultDescription: "使用引擎默认思考行为",
    off: {
      label: "关闭 (Off)",
      description: "关闭思考，快速响应",
    },
    low: {
      label: "较少 (Low)",
      description: "快速响应，基础推理",
    },
    medium: {
      label: "中等 (Medium)",
      description: "平衡思考（默认）",
    },
    high: {
      label: "较多 (High)",
      description: "深度推理，适合复杂任务",
    },
    xhigh: {
      label: "极高 (Extra High)",
      description: "极高思考强度",
    },
    max: {
      label: "最多 (Max)",
      description: "最高思考强度",
    },
    ultra: {
      label: "超强 (Ultra)",
      description: "最高思考强度，并自动委派任务",
    },
  },
};

export default reasoning;
