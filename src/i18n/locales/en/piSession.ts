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
  },
};
