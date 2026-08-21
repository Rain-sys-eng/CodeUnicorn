// Machine translation placeholder of src/i18n/locales/en/dshModes.ts; keys mirror the English source.
// dshModes — English UI strings
const dshModes = {
  dshModes: {
    default: {
      label: "Default Mode",
      tooltip: "Write inside the workspace; wider sandbox retries ask first.",
      description:
        "DSH workspace-write preset. Tools can edit the project, but escalating to full disk access still needs approval.",
    },
    plan: {
      label: "Plan Mode",
      tooltip: "DSH does not expose a plan permission preset in mossx yet.",
      description: "Not available for DeepSeek Harness in this release.",
    },
    acceptEdits: {
      label: "Agent Mode",
      tooltip: "DSH does not expose an auto-edit permission preset.",
      description: "Not available for DeepSeek Harness in this release.",
    },
    bypassPermissions: {
      label: "Auto Mode",
      tooltip: "Switch this DSH session to danger-full-access.",
      description:
        "Unconfined file and shell access for this session. DSH will not prompt to escalate the sandbox. Use with care.",
    },
  },
};

export default dshModes;
