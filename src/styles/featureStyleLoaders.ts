function loadStyles(importers: Array<() => Promise<unknown>>) {
  return Promise.all(importers.map((load) => load())).then(() => undefined);
}

export function loadFileTreeStyles() {
  return loadStyles([
    () => import("./file-tree.css"),
  ]);
}

export function loadDetachedFileExplorerStyles() {
  return loadStyles([
    () => import("./detached-file-explorer.css"),
  ]);
}

export function loadFileViewStyles() {
  return loadStyles([
    () => import("./file-view-panel-shell.css"),
    () => import("./file-view-panel.css"),
    () => import("./file-view-panel.footer.css"),
    () => import("./detached-file-explorer.css"),
  ]);
}

export function loadDiffStyles() {
  return loadStyles([
    () => import("./review-inline.css"),
    () => import("./git-diff-modal.css"),
    () => import("./diff.css"),
    () => import("./diff-viewer.css"),
    () => import("./file-view-panel.css"),
    () => import("./editable-diff-compare-nav.css"),
    () => import("./editable-diff-review-shell.css"),
  ]);
}

export function loadRuntimeConsoleStyles() {
  return loadStyles([
    () => import("./runtime-console.css"),
  ]);
}

export function loadProjectMapStyles() {
  return loadStyles([
    () => import("./project-map.css"),
  ]);
}

export function loadIntentCanvasStyles() {
  return loadStyles([
    () => import("@excalidraw/excalidraw/index.css"),
    () => import("./intent-canvas.css"),
  ]);
}

export function loadSettingsStyles() {
  return loadStyles([
    () => import("./settings.css"),
    () => import("./settings.vendor-pi-auth.css"),
  ]);
}

/**
 * Composer 入口「添加模型」会在未打开设置页时直接挂载 CustomModelDialog。
 * 其壳层/表单样式原先只随 settings.css 懒加载，导致弹窗退化为裸文本布局。
 * 这里只拉 dialog + model-manager 所需切片，避免为了弹窗整包 settings。
 */
export function loadVendorModelManagerStyles() {
  return loadStyles([
    () => import("./settings.vendor-dialog.css"),
    () => import("./settings.part2.vendor-models.css"),
  ]);
}

export function loadReleaseNotesStyles() {
  return loadStyles([
    () => import("./release-notes.css"),
  ]);
}

export function loadLoadingProgressStyles() {
  return loadStyles([
    () => import("./loading-progress-modal.css"),
  ]);
}

export function loadSearchPaletteStyles() {
  return loadStyles([
    () => import("./search-palette.css"),
  ]);
}

export function loadQuickSwitcherStyles() {
  return loadStyles([() => import("./quick-switcher.css")]);
}

export function loadSpecHubStyles() {
  return loadStyles([
    () => import("./spec-hub-header.css"),
    () => import("./spec-hub.css"),
    () => import("./spec-hub.reader-layout.css"),
  ]);
}

export function loadGitHistoryStyles() {
  return Promise.all([
    loadDiffStyles(),
    loadStyles([
      () => import("./git-history.css"),
    ]),
  ]).then(() => undefined);
}

export function loadFileHistoryStyles() {
  return Promise.all([
    loadDiffStyles(),
    loadFileViewStyles(),
    loadStyles([() => import("./file-history.css")]),
  ]).then(() => undefined);
}

/** Extensions 面板 + TokenTracker 仪表盘壳层样式（非首屏路径）。 */
export function loadExtensionsStyles() {
  return loadStyles([
    () => import("./extensions.css"),
    () => import("./tokentracker-dashboard.css"),
  ]);
}

export function loadBrowserAgentStyles() {
  return loadStyles([
    () => import("./browser-agent-window.css"),
    () => import("./browser-agent-dock.css"),
    () => import("./browser-agent-excerpt.css"),
  ]);
}

export function loadAboutStyles() {
  return loadStyles([
    () => import("./about.css"),
  ]);
}

export function loadClientDocumentationStyles() {
  return loadStyles([
    () => import("./client-documentation.css"),
  ]);
}

export function loadMermaidFullscreenStyles() {
  return loadStyles([
    () => import("viewerjs/dist/viewer.css"),
    () => import("./mermaid-fullscreen.css"),
  ]);
}

export function loadImageFullscreenStyles() {
  return loadStyles([
    () => import("viewerjs/dist/viewer.css"),
    () => import("./image-fullscreen.css"),
  ]);
}

export function loadMessagesOutlineFloaterStyles() {
  return loadStyles([
    () => import("./messages-outline-floater.css"),
  ]);
}

/** Terminal dock / panel — non-Home cold-start surface (P1-1). */
export function loadTerminalStyles() {
  return loadStyles([
    () => import("./terminal.css"),
  ]);
}

/** Plan strip / plan panel (P1-1). */
export function loadPlanStyles() {
  return loadStyles([
    () => import("./plan.css"),
  ]);
}

/** Tool call blocks in conversation timeline (P1-1). */
export function loadToolBlockStyles() {
  return loadStyles([
    () => import("./tool-blocks-shell.css"),
    () => import("./tool-blocks.css"),
    () => import("./tool-call-block.css"),
  ]);
}

/** Status panel + engine task output + plan list tabs (P1-1). */
export function loadStatusPanelStyles() {
  return loadStyles([
    () => import("./status-panel.css"),
    () => import("./engine-task-output.css"),
    () => import("./status-panel.responsive.css"),
    () => import("./status-panel.plan-list.css"),
  ]);
}

/**
 * Composer 上方 run-status 展开「任务 / Plan」复用 TodoList / PlanList。
 * 底部 Status dock 已退役，不能指望 StatusPanel 兄弟表面拉起 CSS。
 * 只拉列表切片，禁止整包 status-panel / engine-task-output。
 */
export function loadComposerRunStatusListStyles() {
  return loadStyles([
    () => import("./todo-list.css"),
    () => import("./status-panel.plan-list.css"),
  ]);
}

/**
 * Multi-agent collab surface extras (P1-1).
 * NOTE: subagent-ui.css must stay in bootstrap — it owns the always-on
 * ConversationInspectorSplit chat column layout (see bootstrap.ts).
 */
export function loadSubagentStyles() {
  return loadStyles([
    () => import("./multi-agent.css"),
  ]);
}

/** Workspace session activity right rail (P1-1). */
export function loadSessionActivityStyles() {
  return loadStyles([
    () => import("./session-activity.css"),
  ]);
}

/** Debug panel (P1-1). */
export function loadDebugStyles() {
  return loadStyles([
    () => import("./debug.css"),
  ]);
}

/** Worktree create modal (P1-1). */
export function loadWorktreeModalStyles() {
  return loadStyles([
    () => import("./worktree-modal.css"),
  ]);
}

/** Clone agent modal (P1-1). */
export function loadCloneModalStyles() {
  return loadStyles([
    () => import("./clone-modal.css"),
  ]);
}

/** Workspace alias modal. */
export function loadWorkspaceAliasModalStyles() {
  return loadStyles([
    () => import("./workspace-alias-modal.css"),
  ]);
}
