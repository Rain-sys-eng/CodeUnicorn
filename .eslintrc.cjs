module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/jsx-uses-react': 'off',
    'react/no-unescaped-entities': 'off',
    'react/prop-types': 'off',
    'react/display-name': 'off',
    // 渐进收紧：存量 any 以 warn 曝光（不阻塞 CI），新代码不应再引入。
    '@typescript-eslint/no-explicit-any': 'warn',
    // Ratchet：全仓升 error；存量违规文件白名单见下方 override（只出不进）。
    'react-hooks/exhaustive-deps': 'error',
    // 「声明后先被闭包读取、再赋值」是合法模式（如 renderHook + rerender），不误报。
    'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'lucide-react',
            message:
              "Import icons from 'lucide-react/dist/esm/icons/{kebab-name}' to enable tree-shaking. Type imports (LucideIcon, LucideProps) are allowed via `import type`.",
            allowTypeImports: true,
          },
        ],
      },
    ],
    'no-restricted-globals': [
      'error',
      {
        name: 'alert',
        message: 'Use the application-owned Error Toast or dialog instead of native alert().',
      },
    ],
    'no-restricted-properties': [
      'error',
      {
        object: 'window',
        property: 'alert',
        message:
          'Use the application-owned Error Toast or dialog instead of window.alert().',
      },
    ],
  },
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**/*.ts', '**/__tests__/**/*.tsx'],
      rules: {
        'no-restricted-globals': 'off',
        'no-restricted-properties': 'off',
      },
    },
    {
      files: [
        'src/app-shell.tsx',
        'src/app-shell-parts/renderAppShell.tsx',
        'src/app-shell-parts/useAppShellLayoutNodesSection.tsx',
        'src/app-shell-parts/useAppShellSearchAndComposerSection.ts',
        'src/app-shell-parts/useAppShellSections.ts',
        'src/features/git-history/components/git-history-panel/components/GitHistoryPanelDialogs.tsx',
        'src/features/git-history/components/git-history-panel/components/GitHistoryPanelImpl.tsx',
        'src/features/git-history/components/git-history-panel/components/GitHistoryPanelPickers.tsx',
        'src/features/git-history/components/git-history-panel/components/GitHistoryPanelView.tsx',
        'src/features/git-history/components/git-history-panel/hooks/useGitHistoryPanelInteractions.tsx',
        'src/features/settings/components/SettingsView.tsx',
        'src/features/settings/components/settings-view/sections/CodexSection.tsx',
        'src/features/spec/components/spec-hub/presentational/SpecHubPresentationalImpl.tsx',
      ],
      rules: {
        '@typescript-eslint/ban-ts-comment': 'off',
      },
    },
    {
      files: [
        'src/app-shell.tsx',
        'src/app-shell-parts/renderAppShell.tsx',
        'src/app-shell-parts/useAppShellLayoutNodesSection.tsx',
        'src/app-shell-parts/useAppShellSearchAndComposerSection.ts',
        'src/app-shell-parts/useAppShellSections.ts',
        'src/features/git-history/components/git-history-panel/components/GitHistoryPanelDialogs.tsx',
        'src/features/git-history/components/git-history-panel/components/GitHistoryPanelImpl.tsx',
        'src/features/git-history/components/git-history-panel/components/GitHistoryPanelView.tsx',
        'src/features/git-history/components/git-history-panel/hooks/useGitHistoryPanelInteractions.tsx',
        'src/features/settings/components/SettingsView.tsx',
      ],
      rules: {
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
    {
      files: ['src/features/spec/components/spec-hub/presentational/SpecHubPresentationalImpl.tsx'],
      rules: {
        'no-empty': 'off',
      },
    },
    {
      // exhaustive-deps 存量违规白名单（2026-08-24 基线，共 24 个文件）。
      // 只出不进：清掉一个文件的违规后应将其从此列表移除；禁止新增。
      files: [
        'src/app-shell/domains/layoutChromeProvider.tsx',
        'src/app-shell/domains/useAppShellComposerModelSection.ts',
        'src/app-shell/hosts/useAppShellCatalogHost.ts',
        'src/features/app/components/ApprovalToasts.tsx',
        'src/features/browser-agent/components/BrowserDock.tsx',
        'src/features/browser-agent/hooks/useEmbeddedBrowserWebview.ts',
        'src/features/composer/components/ChatInputBox/ChatInputBox.tsx',
        'src/features/composer/components/Composer.tsx',
        'src/features/engine/hooks/useEngineController.ts',
        'src/features/extensions/tokentracker-dashboard/hooks/use-activity-heatmap.ts',
        'src/features/extensions/tokentracker-dashboard/hooks/use-trend-data.ts',
        'src/features/extensions/tokentracker-dashboard/hooks/use-usage-data.ts',
        'src/features/extensions/tokentracker-dashboard/hooks/use-usage-model-breakdown.ts',
        'src/features/layout/hooks/useLayoutNodes.tsx',
        'src/features/messages/hooks/useFileLinkOpener.ts',
        'src/features/multi-agent/components/AgentInspectorDrawer.tsx',
        'src/features/multi-agent/components/ConversationSurface.tsx',
        'src/features/settings/components/settings-view/sections/BasicAppearanceSection.tsx',
        'src/features/status-panel/hooks/useSessionQuotaList.ts',
        'src/features/theme/components/WorkspaceWallpaperPicker.tsx',
        'src/features/threads/hooks/useQueuedSend.ts',
        'src/features/threads/hooks/useThreadActionsSessionRuntime.ts',
        'src/features/threads/hooks/useThreadMessaging.ts',
        'src/markdown/components/Markdown.tsx',
      ],
      rules: {
        'react-hooks/exhaustive-deps': 'warn',
      },
    },
  ],
};
