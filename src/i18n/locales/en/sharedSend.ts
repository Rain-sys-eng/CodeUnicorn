// sharedSend — English UI strings (Wave 4 / Change B §14.5 UI state machine)
const sharedSend = {
  sharedSend: {
    preparingContext: "Preparing context for the shared session…",
    degradedTitle: "Some context will be omitted",
    degradedHint:
      "Some history cannot be transferred safely. Confirm to continue.",
    degradedConfirm: "Continue sending",
    degradedDetails: "View details",
    degradedMode: "Transfer mode: {{mode}}",
    degradedTokenEstimate:
      "Estimated context size: {{source}} → {{package}} tokens",
    unknownDetail: "Unrecognized protocol value: {{value}}",
    modeNativeDelta: "Native incremental context",
    modeNativeHistoryImport: "Native history import",
    modeNativeHistoryClone: "Native session clone",
    modePortableTranscript: "Portable transcript",
    modeCheckpoint: "Compressed checkpoint",
    dispositionRetrievable: "Retrievable on demand",
    dispositionNotRetrievable: "Not retrievable",
    omissionImageHistory:
      "Images are not supported by the destination history.",
    omissionAssistantOutcome:
      "The assistant turn ended as {{outcome}} and will not be replayed as successful.",
    omissionPrivateReasoning:
      "Provider-private reasoning cannot be transferred.",
    omissionAssistantArtifact:
      "Assistant artifacts remain references and are not injected as text.",
    omissionPrivateBlock:
      "An unsupported private assistant block was omitted.",
    omissionToolHistory:
      "Tool calls and results were omitted together because the destination does not support tool history.",
    omissionHistoricalControl:
      "Historical control actions are reference-only and will not run again.",
    omissionDeterministicFold:
      "Long content was folded to fit the context budget.",
    omissionCheckpointBudget:
      "The oldest complete turn was omitted to fit the context budget.",
    omissionDestinationOwned:
      "Content already present in the destination's native history was not duplicated.",
    omissionUnknown: "Unrecognized omission ({{category}}): {{reason}}",
    outcomeCompleted: "completed",
    outcomeFailed: "failed",
    outcomeCancelled: "cancelled",
    outcomeReplaced: "replaced",
    outcomeUnknown: "unknown",
    awaitingAcceptance:
      "Request sent. Waiting for the CLI to confirm it started processing…",
    cancelUnsupported:
      "This adapter cannot cancel a pending delivery; wait for the runtime verdict.",
    cancelPending: "Confirming the cancel outcome…",
    settling: "Saving the result…",
    recoveryTitle: "Recovery required",
    recoveryTitleShort: "Session stuck",
    recoveryHint:
      "The last send had an ambiguous acknowledgement, so this shared session is locked. Check status, stop delivery, stop and rebuild, or abandon this turn.",
    recoveryHintShort:
      "Whether the last message was received is unclear; locked to keep ordering",
    recoveryAuto: "Auto-fix",
    recoveryAutoWorking: "Working…",
    recoveryAutoRetry: "Retry auto-fix",
    recoveryAutoFailedTitle: "Auto-fix did not work",
    recoveryAutoFailedHint:
      "Auto-fix failed · Next: tap “Skip turn, continue” on the right to unlock",
    recoverySkipRecommendedHint:
      "Recommended: skip the stuck turn to unlock, then send again",
    recoverySkip: "Skip turn, continue",
    recoverySkipHint:
      "Cancel the unconfirmed last turn and unlock; the conversation is kept",
    recoverySkipConfirmTitle: "Skip this turn?",
    recoverySkipConfirm:
      "Skip the unconfirmed last send and unlock the session. The conversation is kept; only this turn is marked cancelled.",
    recoverySkipConfirmAction: "Skip and unlock",
    recoveryDetails: "Details",
    recoveryDetailsTitle: "Why is the session stuck?",
    recoveryDetailsBody:
      "We are not sure whether your last message was actually received by the AI channel. Network blips, a busy channel, or a dropped connection can all leave the send in this unclear state.",
    recoveryDetailsBodyWhy:
      "A shared chat must keep a strict turn order. If we let you send the next message while the last one is still unresolved, the timeline can get out of sync. So the input is locked until this turn is settled.",
    recoveryDetailsAutoTitle: "Auto-fix",
    recoveryDetailsAuto:
      "Best for most cases. One click runs a safe sequence: check status, stop any in-flight request if needed, then change the connection if it is still stuck. It tries to recover or clean up this turn, but it will not skip the turn for you.",
    recoveryDetailsSkipTitle: "Skip turn, continue",
    recoveryDetailsSkip:
      "Use this when you do not want to wait and do not need that unconfirmed message. After you confirm, this turn is marked cancelled and the session unlocks. History is kept. This settles the turn only — it does not replace the underlying connection.",
    recoveryDetailsRebuildTitle: "Change connection",
    recoveryDetailsRebuild:
      "Advanced. Best-effort stop, then archive the old binding and open a new one. The shared chat stays the same; only the underlying pipe changes. Use when the pipe is broken — not as a substitute for skipping the turn.",
    recoveryDetailsDiffTitle: "Skip turn vs change connection",
    recoveryDetailsDiffSkipLabel: "Skip turn",
    recoveryDetailsDiffSkip:
      "Drop the unconfirmed message → mark cancelled → unlock. History stays; no pipe change. Prefer this when auto-fix fails.",
    recoveryDetailsDiffRebuildLabel: "Change connection",
    recoveryDetailsDiffRebuild:
      "Replace the underlying pipe and try again. For broken connections only. May still fail if ownership is mismatched — not the same as abandon.",
    recoveryDetailsDiffTip:
      "Everyday path: auto-fix → if that fails, skip turn. Change connection is for advanced recovery, not a twin of skip.",
    recoveryDetailsAdvancedTitle: "Other advanced options",
    recoveryDetailsAdvanced:
      "Expand also shows “Check again” (read-only status) and “Stop request” (only when something is in flight). Usually unnecessary; after auto-fix fails, prefer skip turn.",
    recoveryDetailsDismiss: "Got it",
    recoveryExpandAdvanced: "Show advanced options",
    recoveryCollapseAdvanced: "Hide advanced options",
    recoveryAdvancedHint:
      "Usually unnecessary. Auto-fix already runs these steps in order.",
    recoveryProbe: "Check again",
    recoveryProbeTitle: "Check again",
    recoveryProbing: "Checking…",
    recoveryProbeStillLocked:
      "Checked again — still unclear. Tap “Skip turn, continue” to unlock, then send again.",
    recoveryProbeHeldNext:
      "Still stuck after check · Next: tap “Skip turn, continue”",
    recoveryProbeReattached: "Reconnected to the in-progress reply. You can wait for the result.",
    recoveryRebuild: "Rebuild binding",
    recoveryStop: "Stop request",
    recoveryStopHint:
      "Ask the runtime to stop the in-flight attempt. The session stays locked until you settle or rebuild.",
    recoveryStopAndRebuild: "Change connection",
    recoveryStopAndRebuildHint:
      "Stop the runtime-owned attempt when needed, then archive the binding and prepare a new connection.",
    recoveryAbandon: "Abandon this turn",
    recoveryAbandonHint:
      "Durably cancel the unresolved turn and unlock the session. Does not delete the conversation.",
    recoveryAbandonConfirm:
      "Abandon this unresolved turn and unlock the shared session? The turn will be marked cancelled. The conversation itself is kept.",
    recoveryStopNoAttempt:
      "There is no in-flight request to stop. Use auto-fix, change connection, or skip this turn.",
    recoveryStopFailedTitle: "Stop request failed",
    recoveryErrorGenericStop:
      "Could not stop the in-flight request. The runtime may be unresponsive; tap “Skip turn, continue” to force-unlock.",
    recoveryHintAfterStop:
      "Stop was requested. Continue with auto-fix, change connection, or skip this turn to unlock.",
    recoveryProbeHeld:
      "Probe found an accepted but uncommitted attempt. The session stays locked to preserve ordering.",
    recoveryProbeCleared: "Probe found no pending attempt. The session is unlocked.",
    recoveryErrorActive:
      "The runtime still owns this attempt. Stop first, or skip this turn to unlock.",
    recoveryErrorActiveRebuild:
      "The runtime still owns this attempt, so change connection was refused. Stop first; if stop also fails, skip this turn to unlock.",
    recoveryErrorActiveRequiresStop:
      "The runtime still owns this attempt. Stop first, or tap “Skip turn, continue” to force-unlock.",
    recoveryErrorActiveRequiresStopSkip:
      "Force-stop during skip did not fully complete. Tap “Skip turn, continue” again; if it still fails, restart the app.",
    recoverySkipFailedTitle: "Skip turn failed",
    recoveryErrorGenericSkip:
      "Skip turn could not unlock the session. Try again; if it keeps failing, restart the app.",
    recoveryErrorAmbiguous:
      "Multiple unresolved owners were found. Recovery cannot safely continue automatically; contact support with session details if this persists.",
    recoveryErrorOwnerMissing:
      "No matching unresolved attempt was found. Try check again; the session may already be clear.",
    recoveryErrorOwnerMismatch:
      "The connection state does not line up, so this step cannot continue. Tap “Skip turn, continue” to unlock, then send again.",
    recoveryErrorOwnerMismatchRebuild:
      "Change connection did not finish: connection identity does not match. Tap “Skip turn, continue” to unlock, or switch target and send again.",
    recoveryErrorGenericNext:
      "This step could not unlock the session. Tap “Skip turn, continue”, then send again.",
    recoveryErrorGenericRebuild:
      "Change connection could not unlock the session. Tap “Skip turn, continue”, then send again.",
    recoveryRebuildFailedTitle: "Change connection failed",
    recoveryErrorEmptyContextHandoff:
      "Shared context could not be rebuilt for this target (history may be incomplete). Change connection, or switch to another available target and resend.",
    recoveryTechDetail: "technical detail available",
    targetUnavailable: "The selected target is unavailable.",
    targetUnavailableReason: "The selected target is unavailable: {{reason}}",
    targetUnavailableHint: "Switch to another target in the picker, then send again.",
    selectionPersistFailedTitle: "Target selection was not saved",
    selectionPersistFailedMessage:
      "The current in-memory selection is preserved, but restart recovery may use the previous target: {{reason}}",
    cancel: "Cancel",
    providerRetryPillOn: "Retry {{count}}x",
    providerRetryPillOff: "Retry off",
    providerRetryTitle: "Retry vendor failures",
    providerRetryScope:
      "Current CLI: {{cli}}. Changes apply only to {{cli}} in this shared session and reset after refresh.",
    providerRetryEnabled: "Retry automatically",
    providerRetryMax: "Attempts",
    providerRetryBackoff: "Backoff",
    providerRetryBackoffExp: "Exponential ×2",
    providerRetryBackoffFixed: "Fixed",
    providerRetryBase: "First delay (sec)",
    providerRetryCap: "Max delay (sec)",
    providerRetryUnit: "sec",
    providerRetryDelayHint:
      "Wait this many seconds after the first failure, then double on later retries, never past the max delay.",
    providerRetryPrompt: "Resume prompt sent to the CLI",
    providerRetryWait:
      "{{cli}} failed ({{reason}}) · retrying in {{seconds}}s {{n}}/{{max}}",
    providerRetrySending: "Sending to {{cli}} · {{n}}/{{max}}",
    providerRetryExhausted: "{{cli}} still failed after {{n}} retries",
    providerRetryPermanent: "{{reason}}. Will not retry automatically",
    providerRetryStopped: "Automatic retries stopped",
    providerRetrySuccess: "Connected on attempt {{n}}",
    providerRetryNow: "Now",
    providerRetryStop: "Stop",
    providerRetryAgain: "Retry",
    providerRetryAutoMark: "Auto resume #{{n}} · {{date}}",
    providerRetryReasonPool: "key pool",
    providerRetryReasonRate: "rate limit",
    providerRetryReasonTimeout: "timeout",
    providerRetryReasonOverload: "overload",
    providerRetryReasonServer: "server error",
    providerRetryReasonSoftCancel: "interrupted",
    providerRetryReasonConfig: "config error",
    providerRetryReasonOverflow: "context too long",
    providerRetryReasonQuota: "quota exhausted",
    providerRetryReasonPermission: "permission denied",
    providerRetryReasonStopped: "stopped",
    providerRetryReasonUnknown: "temporary failure",
  },
};

export default sharedSend;
