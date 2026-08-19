// sharedSend — 简体中文 UI 文案（Wave 4 / Change B §14.5 UI 状态机）
const sharedSend = {
  sharedSend: {
    preparingContext: "正在准备共享会话上下文…",
    degradedTitle: "部分上下文未携带",
    degradedHint: "部分历史内容无法安全迁移，确认后才会继续发送。",
    degradedConfirm: "继续发送",
    degradedDetails: "查看详情",
    degradedMode: "传递方式：{{mode}}",
    degradedTokenEstimate:
      "估算上下文用量：{{source}} → {{package}} 个令牌",
    unknownDetail: "未识别的协议值：{{value}}",
    modeNativeDelta: "原生增量上下文",
    modeNativeHistoryImport: "原生历史导入",
    modeNativeHistoryClone: "原生会话克隆",
    modePortableTranscript: "兼容文本转录",
    modeCheckpoint: "压缩检查点",
    dispositionRetrievable: "可按需取回",
    dispositionNotRetrievable: "无法取回",
    omissionImageHistory: "目标历史不支持图片，图片未携带。",
    omissionAssistantOutcome:
      "助手轮次以“{{outcome}}”结束，不会作为成功回复重放。",
    omissionPrivateReasoning: "供应商私有思考内容无法迁移。",
    omissionAssistantArtifact: "助手产物仅保留引用，不会作为正文注入。",
    omissionPrivateBlock: "不受支持的助手私有内容块已省略。",
    omissionToolHistory:
      "目标不支持工具历史，工具调用与结果已成对省略。",
    omissionHistoricalControl: "历史控制操作仅保留引用，不会再次执行。",
    omissionDeterministicFold: "长内容已折叠，以满足上下文容量限制。",
    omissionCheckpointBudget:
      "最早的完整轮次已省略，以满足上下文容量限制。",
    omissionDestinationOwned:
      "目标原生历史已有该内容，不再重复携带。",
    omissionUnknown: "未识别的省略项（{{category}}）：{{reason}}",
    outcomeCompleted: "完成",
    outcomeFailed: "失败",
    outcomeCancelled: "已取消",
    outcomeReplaced: "已替换",
    outcomeUnknown: "未知",
    awaitingAcceptance: "请求已发送，正在确认 CLI 是否开始处理…",
    cancelUnsupported: "当前执行方式不支持取消待确认的投递，请等待接收结果。",
    cancelPending: "正在确认取消结果…",
    settling: "正在保存结果…",
    recoveryTitle: "需要恢复",
    recoveryTitleShort: "会话卡住",
    recoveryHint:
      "上一次发送的接收结果不确定，已锁定本会话。请检查状态、停止投递、停止并重建，或放弃本轮。",
    recoveryHintShort: "上一句有没有被对面收到还不清楚，先锁住避免乱序",
    recoveryAuto: "自动处理",
    recoveryAutoWorking: "处理中…",
    recoveryAutoRetry: "再试自动处理",
    recoveryAutoFailedTitle: "自动处理没成功",
    recoveryAutoFailedHint: "自动失败了 · 下一步：点右侧「跳过本轮，继续聊」解锁",
    recoverySkipRecommendedHint:
      "推荐：点这里跳过卡住的上一句并解锁，然后可以重新发送",
    recoverySkip: "跳过本轮，继续聊",
    recoverySkipHint: "取消未确认的上一句并解锁会话；对话本身会保留",
    recoverySkipConfirmTitle: "跳过本轮？",
    recoverySkipConfirm:
      "将跳过上一句未确认的发送并解锁会话。对话本身会保留，只有这一轮记为取消。",
    recoverySkipConfirmAction: "跳过并解锁",
    recoveryDetails: "查看详情",
    recoveryDetailsTitle: "为什么会话会卡住？",
    recoveryDetailsBody:
      "刚才那句话有没有真正被对面的 AI 渠道接收到，我们暂时还说不准。网络抖动、渠道繁忙、连接中断时，都可能出现这种「半路上说不清」的情况。",
    recoveryDetailsBodyWhy:
      "共享会话必须按顺序接话，不能一边还没定论、一边又发出下一句，否则历史会对不齐。所以会先暂时锁住输入框，等这轮有了明确结果再继续聊。",
    recoveryDetailsAutoTitle: "自动处理",
    recoveryDetailsAuto:
      "适合大多数情况。点一下后，系统会按顺序帮你排查：先确认当前状态，若还有进行中的请求会尝试停掉，仍解不开时会换一条底层连接。它会尽量保住或清干净这轮，但不会擅自替你「不要这轮」。",
    recoveryDetailsSkipTitle: "跳过本轮，继续聊",
    recoveryDetailsSkip:
      "适合你不想再等、也不在乎这一句是否发出去的时候。确认后，未决的这一轮会记为取消，会话立刻解锁。整段对话记录还在，不会删聊天。它处理的是「这一句话」，不会去换底层连接。",
    recoveryDetailsRebuildTitle: "换连接",
    recoveryDetailsRebuild:
      "高级操作。会尽量先停掉进行中的请求，再归档旧的底层连接并新开一条。共用会话还是这个，换的是下面那根「管子」。管道坏了、连接乱了时才需要；它不是「跳过本轮」的替身。",
    recoveryDetailsDiffTitle: "跳过本轮 vs 换连接，差在哪？",
    recoveryDetailsDiffSkipLabel: "跳过本轮",
    recoveryDetailsDiffSkip:
      "不要这句未确认的话 → 本轮记取消 → 解锁。对话还在，不换管道。失败时优先点它。",
    recoveryDetailsDiffRebuildLabel: "换连接",
    recoveryDetailsDiffRebuild:
      "换底层管道再试。连接坏了才用。状态对不上时可能仍失败，不能当放弃用。",
    recoveryDetailsDiffTip:
      "日常优先：自动处理 → 不行就跳过本轮。换连接留给高级排查，不要和跳过当成一回事。",
    recoveryDetailsAdvancedTitle: "其他高级选项",
    recoveryDetailsAdvanced:
      "展开后还有「再查一次」（只查看是否已有结果）、「停止请求」（仅当有进行中的请求时可点）。一般不必用；自动失败时请优先跳过本轮。",
    recoveryDetailsDismiss: "知道了",
    recoveryExpandAdvanced: "展开高级选项",
    recoveryCollapseAdvanced: "收起高级选项",
    recoveryAdvancedHint: "一般不用点这里。自动处理已经会按顺序试下面几步。",
    recoveryProbe: "再查一次",
    recoveryProbeTitle: "再查一次",
    recoveryProbing: "正在检查…",
    recoveryProbeStillLocked:
      "查过了，这轮还是说不清。请点「跳过本轮，继续聊」解锁，再重新发。",
    recoveryProbeHeldNext:
      "查过了仍卡住 · 下一步：点「跳过本轮，继续聊」",
    recoveryProbeReattached: "已接上正在进行的回复，可以等待结果。",
    recoveryRebuild: "重建会话连接",
    recoveryStop: "停止请求",
    recoveryStopHint:
      "请求运行时停止正在进行的投递。停止后会话仍保持锁定，需继续结算或重建。",
    recoveryStopAndRebuild: "换连接",
    recoveryStopAndRebuildHint:
      "必要时先停止运行时仍占用的投递，再归档旧连接并准备新的会话连接。",
    recoveryAbandon: "放弃本轮",
    recoveryAbandonHint:
      "将未决轮次持久标记为已取消并解锁会话。不会删除整条对话。",
    recoveryAbandonConfirm:
      "确定放弃本轮未决发送并解锁共享会话吗？该轮次将标记为已取消，对话本身会保留。",
    recoveryStopNoAttempt:
      "当前没有可停止的进行中请求。请改用自动处理、换连接，或跳过本轮。",
    recoveryStopFailedTitle: "停止请求失败",
    recoveryErrorGenericStop:
      "没能停掉进行中的请求。Runtime 可能已无响应；请直接点「跳过本轮，继续聊」强制解锁。",
    recoveryHintAfterStop:
      "已请求停止。请继续自动处理、换连接，或跳过本轮以完成解锁。",
    recoveryProbeHeld:
      "检查发现发送已被接收，但结果尚未保存；为保证顺序，继续保持锁定。",
    recoveryProbeCleared: "未发现待处理的发送，已解除锁定。",
    recoveryErrorActive:
      "运行时仍占用该次投递。请先停止请求，或直接跳过本轮解锁。",
    recoveryErrorActiveRebuild:
      "运行时仍占用该次投递，换连接被拒绝。请先停止请求；若停止也失败，请直接「跳过本轮」解锁。",
    recoveryErrorActiveRequiresStop:
      "运行时仍占用该次投递。请先停止请求，或点「跳过本轮」强制解锁。",
    recoveryErrorActiveRequiresStopSkip:
      "跳过时强制停止未完全成功。请再点一次「跳过本轮」；若仍失败请重启应用后重试。",
    recoverySkipFailedTitle: "跳过本轮失败",
    recoveryErrorGenericSkip:
      "跳过本轮没能解锁。请再试一次；若持续失败请重启应用。",
    recoveryErrorAmbiguous:
      "检测到多个未决发送，无法安全自动恢复；若持续出现请联系支持并提供会话详情。",
    recoveryErrorOwnerMissing:
      "未找到匹配的未决投递。请尝试再查一次，会话可能已解锁。",
    recoveryErrorOwnerMismatch:
      "当前连接状态对不上，没法继续这一步。请点「跳过本轮，继续聊」解锁，然后重新发一句。",
    recoveryErrorOwnerMismatchRebuild:
      "换连接没完成：连接身份对不上。请点「跳过本轮，继续聊」解锁，或切换可用目标后再发。",
    recoveryErrorGenericNext:
      "这一步没能解开。请点「跳过本轮，继续聊」解锁会话，再重新发送。",
    recoveryErrorGenericRebuild:
      "换连接没能解开会话。请点「跳过本轮，继续聊」解锁，再重新发送。",
    recoveryRebuildFailedTitle: "换连接失败",
    recoveryErrorEmptyContextHandoff:
      "无法为当前目标重建共享上下文（历史可能不完整）。请尝试换连接，或切换可用目标后重发。",
    recoveryTechDetail: "可查看技术详情",
    targetUnavailable: "当前发送目标不可用。",
    targetUnavailableReason: "当前发送目标不可用：{{reason}}",
    targetUnavailableHint: "请在目标选择器中切换到其他可用目标，然后重新发送。",
    selectionPersistFailedTitle: "发送目标保存失败",
    selectionPersistFailedMessage:
      "当前选择仍然有效，但重启恢复时可能使用上一次发送目标：{{reason}}",
    cancel: "取消",
    providerRetryPillOn: "重试 {{count}}次",
    providerRetryPillOff: "重试 关",
    providerRetryTitle: "供应商失败自动重试",
    providerRetryScope: "当前 CLI：{{cli}}。只对这个共用会话的 {{cli}} 生效，刷新后回到默认。",
    providerRetryEnabled: "自动再试",
    providerRetryMax: "次数",
    providerRetryBackoff: "退避",
    providerRetryBackoffExp: "指数 ×2",
    providerRetryBackoffFixed: "固定",
    providerRetryBase: "第一次等（秒）",
    providerRetryCap: "最长再等（秒）",
    providerRetryUnit: "秒",
    providerRetryDelayHint: "第一次失败后先等这么多秒再发；之后按退避翻倍，但不会超过最长再等。",
    providerRetryPrompt: "发给 CLI 的续跑指令",
    providerRetryWait: "{{cli}} 暂时失败（{{reason}}）· {{seconds}}s 后再试 {{n}}/{{max}}",
    providerRetrySending: "正在发给 {{cli}} · {{n}}/{{max}}",
    providerRetryExhausted: "{{cli}} 已重试 {{max}} 次仍失败",
    providerRetryPermanent: "{{reason}}，不自动再发",
    providerRetryStopped: "已停止后续自动重试",
    providerRetrySuccess: "第 {{n}} 次已接通",
    providerRetryNow: "立即",
    providerRetryStop: "停止",
    providerRetryAgain: "再试",
    providerRetryAutoMark: "自动续跑",
    providerRetryReasonPool: "号池",
    providerRetryReasonRate: "请求过多",
    providerRetryReasonTimeout: "超时",
    providerRetryReasonOverload: "过载",
    providerRetryReasonServer: "服务错误",
    providerRetryReasonSoftCancel: "暂时中断",
    providerRetryReasonConfig: "配置错误",
    providerRetryReasonOverflow: "上下文过长",
    providerRetryReasonPermission: "权限拒绝",
    providerRetryReasonStopped: "已停止",
    providerRetryReasonUnknown: "暂时失败",
  },
};

export default sharedSend;
