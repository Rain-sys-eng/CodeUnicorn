export default {
  piSession: {
    fork: {
      title: "Fork from this message",
      description:
        "Creates a new session file from the point before this message: the message becomes a draft you rewrite, and the source session stays untouched. The new branch appears in the session tree panel (not in the sidebar), and you jump to it automatically.",
      cancel: "Cancel",
      confirm: "Create fork",
      confirming: "Forking…",
      successTitle: "✓ Fork created",
      successBody:
        "The new branch is in the session tree panel on the right, with the source message pre-filled as its composer draft — jump over to continue.",
      errorEntryNotFound:
        "Couldn't locate this message in the pi session (it may have been compacted).",
      errorEntryNotForkable:
        "This message isn't in the current session file — it belongs to another branch in the session tree (or was compacted), so it can't be forked from here. In the session tree, jump to the branch that owns this message first (↪), then fork it there.",
    },
    compact: {
      entryTitle: "Compact context (pi RPC: compact)",
      entryLabel: "Compact",
      dialogTitle: "Compact context",
      dialogAria: "Compact context",
      occupancy: "Context used",
      messages: "Messages",
      tokens: "Context tokens",
      instructionsLabel: "Instructions (optional)",
      instructionsPlaceholder:
        "e.g. keep root-cause conclusions and file lists; compress trial-and-error",
      hint: "Compaction is lossy. Full history stays in the pi session file and can be traced in the session tree.",
      cancel: "Cancel",
      close: "Close",
      confirm: "Compact context",
      confirming: "Compacting…",
      tooShort:
        "This session is still short — nothing to compact (pi keeps the last ~20k tokens intact).",
      done: "Compacted: {{before}} → {{after}} (estimate).",
    },
    tree: {
      panelAria: "Session tree",
      badge: "PI session tree",
      resizeAria: "Resize session tree panel",
      chipTitle:
        "Session branches ({{count}} lanes) · open the session tree (pi RPC has no lane-switch command)",
      sidebarBadgeTitle: "Session tree has {{count}} branches · click to view",
      loadFailed: "सत्र ट्री लोड करने में विफल",
      retry: "पुनः प्रयास करें",
    },
  },
};
