// promptEnhancer — English UI strings
const promptEnhancer = {
  promptEnhancer: {
    title: "Prompt Enhancer",
    tooltip: "Enhance Prompt",
    tooltipFull:
      "Rewrite prompt to provide more context and improve agent responses",
    shortcut: "⌘/ / Ctrl+/",
    enhancing: "Enhancing prompt...",
    readyToEnhance: "Choose a model and intensity, then start enhancement.",
    runSettings: "Enhancement settings",
    subtitle: "Side-by-side review",
    provider: "Provider",
    model: "Model",
    noModel: "No model",
    timeoutSeconds: "Timeout (seconds)",
    advancedTimeout: "Advanced · Timeout",
    intensityLabel: "Rewrite intensity",
    intensityLightHint: "Polish wording; do not expand a short draft",
    intensityStructHint: "Add sections only when they introduce new constraints",
    intensityExecHint: "Add actions and verification without inventing facts",
    noEnabledEngine: "No enabled CLI. Enable an engine in vendor settings first.",
    originalEditable: "Editable",
    diffLegend: "Green = added",
    waitingEnhance: "Waiting to enhance",
    enhancingWithEngine: "{{engine}} is enhancing",
    intensity: {
      light: "Light",
      struct: "Structured",
      exec: "Executable",
    },
    runEnhancement: "Start Enhancement",
    originalPrompt: "Original Prompt",
    enhancedPrompt: "Enhanced Prompt",
    useEnhanced: "Use Enhanced",
    keepOriginal: "Keep Original",
    enhanceFailed: "Failed to enhance prompt",
    failedTimeout: "Prompt enhancement timed out after {{seconds}}s",
    failedWorkspace: "Workspace is not ready for prompt enhancement",
    failedEmpty: "The engine returned an empty enhancement",
    failedGeneric: "Prompt enhancement failed",
    failedDshCatalogId:
      "DSH needs a provider/model catalog id. Select a DSH catalog row instead of a bare runtime name like {{model}}.",
    emptyPrompt: "Please enter a prompt first",
    copyEnhanced: "Copy Enhanced",
  },
};

export default promptEnhancer;
