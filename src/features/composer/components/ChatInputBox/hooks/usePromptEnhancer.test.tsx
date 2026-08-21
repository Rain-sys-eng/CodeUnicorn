/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { engineSendMessageSync } from '../../../../../services/tauri';
import {
  PROMPT_ENHANCER_ENGINE_OPTIONS,
  PromptEnhancerError,
  buildPromptEnhancerInstruction,
  classifyPromptEnhancerError,
  clearPromptEnhancerCacheForTests,
  normalizeEnhancedPromptResponse,
  resolveEnhancerLocale,
  resolveEnhancerModelForSend,
  resolveVisibleEnhancerEngines,
  usePromptEnhancer,
} from './usePromptEnhancer';
import { seedCliEngineVisibility } from '../../../hooks/cliEngineVisibilityStore';

vi.mock('../../../../../services/tauri', () => ({
  engineSendMessageSync: vi.fn(),
}));

const defaultModelGroups = [
  {
    providerId: 'claude' as const,
    providerLabel: 'Claude Code',
    enabled: true,
    models: [
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', model: 'claude-sonnet-4-5' },
    ],
  },
  {
    providerId: 'codex' as const,
    providerLabel: 'Codex',
    enabled: true,
    models: [
      { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', model: 'gpt-5.1-codex' },
    ],
  },
  {
    providerId: 'gemini' as const,
    providerLabel: 'Gemini',
    enabled: true,
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', model: 'gemini-2.5-pro' },
    ],
  },
  {
    providerId: 'opencode' as const,
    providerLabel: 'OpenCode',
    enabled: true,
    models: [],
  },
];

function renderPromptEnhancer(options?: {
  currentProvider?: string;
  selectedModel?: string;
  draft?: string;
  workspaceId?: string | null;
  modelGroups?: typeof defaultModelGroups;
  targetModelGroups?: typeof defaultModelGroups;
}) {
  const editableRef = { current: null };
  const setHasContent = vi.fn();
  const handleInput = vi.fn();

  const hook = renderHook(() =>
    usePromptEnhancer({
      workspaceId: options && 'workspaceId' in options ? options.workspaceId : 'ws-1',
      editableRef,
      getTextContent: () => options?.draft ?? '报告管理页面加载数据时，标题的获取逻辑是什么',
      currentProvider: options?.currentProvider ?? 'claude',
      selectedModel: options?.selectedModel ?? 'claude-sonnet-4-5',
      modelGroups: options?.modelGroups ?? defaultModelGroups,
      targetModelGroups: options?.targetModelGroups,
      setHasContent,
      handleInput,
    }),
  );

  return { ...hook, setHasContent, handleInput };
}

afterEach(() => {
  vi.clearAllMocks();
  clearPromptEnhancerCacheForTests();
  act(() => {
    seedCliEngineVisibility([]);
  });
});

describe('usePromptEnhancer', () => {
  it('opens the dialog without starting enhancement automatically', () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    const { result } = renderPromptEnhancer();

    act(() => {
      result.current.handleEnhancePrompt();
    });

    expect(result.current.showEnhancerDialog).toBe(true);
    expect(result.current.originalPrompt).toBe('报告管理页面加载数据时，标题的获取逻辑是什么');
    expect(result.current.isEnhancing).toBe(false);
    expect(sendSync).not.toHaveBeenCalled();
  });

  it('keeps Gemini unavailable even when the current provider is legacy Gemini', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync.mockResolvedValueOnce({
      engine: 'claude',
      text: '请说明报告管理页面标题加载逻辑。',
    });

    const { result } = renderPromptEnhancer({
      currentProvider: 'gemini',
      selectedModel: 'gemini-2.5-pro',
    });

    act(() => {
      result.current.handleEnhancePrompt();
    });

    await waitFor(() => {
      expect(result.current.showEnhancerDialog).toBe(true);
    });

    act(() => {
      result.current.handleEnhancerEngineChange('gemini');
      result.current.handleEnhancerTimeoutChange(12);
    });

    await waitFor(() => {
      expect(result.current.selectedEnhancerEngine).toBe('claude');
      expect(result.current.selectedEnhancerModel).toBe('claude-sonnet-4-5');
      expect(result.current.enhancerTimeoutSeconds).toBe(12);
    });

    act(() => {
      result.current.handleRunPromptEnhancement();
    });

    await waitFor(() => {
      expect(result.current.isEnhancing).toBe(false);
      expect(result.current.canUseEnhancedPrompt).toBe(true);
    });

    expect(PROMPT_ENHANCER_ENGINE_OPTIONS).not.toContain('gemini');
    expect(result.current.enhancingEngine).toBe('claude');
    expect(sendSync).toHaveBeenCalledTimes(1);
    expect(sendSync.mock.calls[0]?.[1].engine).toBe('claude');
    expect(sendSync.mock.calls[0]?.[1].model).toBe('claude-sonnet-4-5');
  });

  it('defaults to the current composer engine when that CLI is enabled', () => {
    const { result } = renderPromptEnhancer({
      currentProvider: 'opencode',
      selectedModel: '',
    });

    act(() => {
      result.current.handleEnhancePrompt();
    });

    expect(PROMPT_ENHANCER_ENGINE_OPTIONS).toEqual([
      'claude',
      'codex',
      'grok',
      'kimi',
      'opencode',
      'pi',
      'dsh',
    ]);
    expect(result.current.selectedEnhancerEngine).toBe('opencode');
    expect(result.current.visibleEnhancerEngines).toContain('opencode');
    expect(result.current.enhancerModelGroups.map((group) => group.providerId)).toEqual(
      result.current.visibleEnhancerEngines,
    );
    expect(result.current.enhancerModelGroups.some((group) => group.providerId === 'gemini')).toBe(false);
  });

  it('hides vendor-disabled engines and does not select them', () => {
    act(() => {
      seedCliEngineVisibility(['opencode', 'kimi']);
    });
    const { result } = renderPromptEnhancer({
      currentProvider: 'opencode',
      selectedModel: '',
    });

    act(() => {
      result.current.handleEnhancePrompt();
    });

    expect(result.current.visibleEnhancerEngines).not.toContain('opencode');
    expect(result.current.selectedEnhancerEngine).toBe('claude');

    act(() => {
      result.current.handleEnhancerEngineChange('opencode');
    });
    expect(result.current.selectedEnhancerEngine).toBe('claude');
  });

  it('does not start enhancement when no executable CLI is enabled', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    act(() => {
      seedCliEngineVisibility(['claude', 'codex', 'grok', 'kimi', 'opencode', 'pi', 'dsh']);
    });
    const { result } = renderPromptEnhancer();

    act(() => {
      result.current.handleEnhancePrompt();
    });
    expect(result.current.visibleEnhancerEngines).toEqual([]);

    act(() => {
      result.current.handleRunPromptEnhancement();
    });
    expect(result.current.isEnhancing).toBe(false);
    expect(sendSync).not.toHaveBeenCalled();
  });

  it('sends a DSH catalog id and refuses a leftover Grok runtime name', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync.mockResolvedValue({
      engine: 'dsh',
      text: '请说明登录重复提交的最小修复。',
    });
    const dshGroups = [
      ...defaultModelGroups,
      {
        providerId: 'dsh' as const,
        providerLabel: 'dsh',
        enabled: true,
        models: [
          { id: 'gork-zhu/grok-4.6', label: 'gork-zhu / grok-4.6', model: 'grok-4.6' },
        ],
      },
    ];
    const { result } = renderPromptEnhancer({
      currentProvider: 'dsh',
      selectedModel: 'grok-4.6',
      modelGroups: dshGroups,
    });

    act(() => {
      result.current.handleEnhancePrompt();
    });
    expect(result.current.selectedEnhancerEngine).toBe('dsh');
    expect(result.current.selectedEnhancerModel).toBe('gork-zhu/grok-4.6');

    act(() => {
      result.current.handleRunPromptEnhancement();
    });
    await waitFor(() => {
      expect(result.current.canUseEnhancedPrompt).toBe(true);
    });
    expect(sendSync.mock.calls[0]?.[1].engine).toBe('dsh');
    expect(sendSync.mock.calls[0]?.[1].model).toBe('gork-zhu/grok-4.6');

    act(() => {
      result.current.handleEnhancerProviderModelChange('dsh', 'grok-4.6');
    });
    expect(result.current.selectedEnhancerModel).toBe('gork-zhu/grok-4.6');
    act(() => {
      result.current.handleEnhancerIntensityChange('struct');
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });
    await waitFor(() => {
      expect(sendSync).toHaveBeenCalledTimes(2);
    });
    expect(sendSync.mock.calls[1]?.[1].model).toBe('gork-zhu/grok-4.6');
  });

  it('resolves a DSH catalog id from atomic target groups when legacy groups omit DSH', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync.mockResolvedValue({
      engine: 'dsh',
      text: '请说明登录重复提交的最小修复。',
    });
    const { result } = renderPromptEnhancer({
      currentProvider: 'dsh',
      selectedModel: 'grok-4.6',
      targetModelGroups: [
        {
          providerId: 'dsh' as const,
          providerLabel: 'dsh',
          enabled: true,
          models: [
            { id: 'gork-zhu/grok-4.6', label: 'gork-zhu / grok-4.6', model: 'grok-4.6' },
          ],
        },
      ],
    });

    act(() => {
      result.current.handleEnhancePrompt();
    });
    expect(result.current.selectedEnhancerModel).toBe('gork-zhu/grok-4.6');
    act(() => {
      result.current.handleRunPromptEnhancement();
    });
    await waitFor(() => {
      expect(result.current.canUseEnhancedPrompt).toBe(true);
    });
    expect(sendSync.mock.calls[0]?.[1].model).toBe('gork-zhu/grok-4.6');
  });

  it('backfills a DSH catalog id after atomic models arrive', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync.mockResolvedValue({
      engine: 'dsh',
      text: '请说明登录重复提交的最小修复。',
    });
    let targetModelGroups: typeof defaultModelGroups | undefined;
    const { result, rerender } = renderHook(() =>
      usePromptEnhancer({
        workspaceId: 'ws-1',
        editableRef: { current: null },
        getTextContent: () => '报告管理页面加载数据时，标题的获取逻辑是什么',
        currentProvider: 'dsh',
        selectedModel: 'grok-4.6',
        modelGroups: defaultModelGroups,
        targetModelGroups,
        setHasContent: vi.fn(),
        handleInput: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleEnhancePrompt();
    });
    expect(result.current.selectedEnhancerModel).toBe('');

    targetModelGroups = [
      {
        providerId: 'dsh' as const,
        providerLabel: 'dsh',
        enabled: true,
        models: [
          { id: 'gork-zhu/grok-4.6', label: 'gork-zhu / grok-4.6', model: 'grok-4.6' },
        ],
      },
    ];
    rerender();
    await waitFor(() => {
      expect(result.current.selectedEnhancerModel).toBe('gork-zhu/grok-4.6');
    });
  });

  it('does not send a bare DSH runtime leftover when the catalog is empty', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    const { result } = renderPromptEnhancer({
      currentProvider: 'dsh',
      selectedModel: 'grok-4.6',
      modelGroups: defaultModelGroups,
    });

    act(() => {
      result.current.handleEnhancePrompt();
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });

    expect(sendSync).not.toHaveBeenCalled();
    expect(result.current.canUseEnhancedPrompt).toBe(false);
    expect(result.current.enhancedPrompt).toContain('DSH needs a provider/model catalog id');
  });

  it('falls back to Codex when Claude enhancement exits before returning text', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync
      .mockRejectedValueOnce(new Error('Claude exited with status: exit status: 1'))
      .mockResolvedValueOnce({
        engine: 'codex',
        text: '请说明报告管理页面加载数据时标题字段的来源、兜底逻辑和异常处理。',
      });

    const { result } = renderPromptEnhancer();

    act(() => {
      result.current.handleEnhancePrompt();
    });

    await waitFor(() => {
      expect(result.current.showEnhancerDialog).toBe(true);
    });

    act(() => {
      result.current.handleRunPromptEnhancement();
    });

    await waitFor(() => {
      expect(result.current.isEnhancing).toBe(false);
      expect(result.current.canUseEnhancedPrompt).toBe(true);
    });

    expect(result.current.enhancingEngine).toBe('codex');
    expect(result.current.enhancedPrompt).toBe(
      '请说明报告管理页面加载数据时标题字段的来源、兜底逻辑和异常处理。',
    );
    expect(sendSync).toHaveBeenCalledTimes(2);
    expect(sendSync.mock.calls[0]?.[1].engine).toBe('claude');
    expect(sendSync.mock.calls[0]?.[1].model).toBe('claude-sonnet-4-5');
    expect(sendSync.mock.calls[1]?.[1].engine).toBe('codex');
    expect(sendSync.mock.calls[1]?.[1].model).toBeNull();
  });

  it('normalizes duplicated Claude enhancement text before showing the result', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync.mockResolvedValueOnce({
      engine: 'claude',
      text: [
        '请检查 Claude Code 提示词增强是否仍会重复返回同一段信息。',
        '请给出复现条件、根因判断和最小修复方案。',
        '',
        '请检查 Claude Code 提示词增强是否仍会重复返回同一段信息。',
        '请给出复现条件、根因判断和最小修复方案。',
      ].join('\n'),
    });

    const { result } = renderPromptEnhancer({
      currentProvider: 'claude',
      draft: '提示词增强返回重复信息，重点看 Claude Code。',
    });

    act(() => {
      result.current.handleEnhancePrompt();
    });

    await waitFor(() => {
      expect(result.current.showEnhancerDialog).toBe(true);
    });

    act(() => {
      result.current.handleRunPromptEnhancement();
    });

    await waitFor(() => {
      expect(result.current.isEnhancing).toBe(false);
      expect(result.current.canUseEnhancedPrompt).toBe(true);
    });

    expect(result.current.enhancedPrompt).toBe(
      '请检查 Claude Code 提示词增强是否仍会重复返回同一段信息。请给出复现条件、根因判断和最小修复方案。',
    );
    expect(
      result.current.enhancedPrompt.match(/请检查 Claude Code 提示词增强/g),
    ).toHaveLength(1);
    expect(sendSync).toHaveBeenCalledTimes(1);
  });

  it('normalizes duplicated Codex enhancement text before showing the result', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync.mockResolvedValueOnce({
      engine: 'codex',
      text: [
        '请检查 Codex 提示词增强是否仍会重复返回同一段信息。',
        '请给出复现条件、根因判断和最小修复方案。',
        '',
        '请检查 Codex 提示词增强是否仍会重复返回同一段信息。',
        '请给出复现条件、根因判断和最小修复方案。',
      ].join('\n'),
    });

    const { result } = renderPromptEnhancer({
      currentProvider: 'codex',
      selectedModel: 'gpt-5.1-codex',
      draft: '提示词增强返回重复信息，重点看 Codex。',
    });

    act(() => {
      result.current.handleEnhancePrompt();
    });

    await waitFor(() => {
      expect(result.current.showEnhancerDialog).toBe(true);
    });

    act(() => {
      result.current.handleRunPromptEnhancement();
    });

    await waitFor(() => {
      expect(result.current.isEnhancing).toBe(false);
      expect(result.current.canUseEnhancedPrompt).toBe(true);
    });

    expect(result.current.enhancingEngine).toBe('codex');
    expect(result.current.enhancedPrompt).toBe(
      '请检查 Codex 提示词增强是否仍会重复返回同一段信息。请给出复现条件、根因判断和最小修复方案。',
    );
    expect(result.current.enhancedPrompt.match(/请检查 Codex 提示词增强/g)).toHaveLength(1);
    expect(sendSync).toHaveBeenCalledTimes(1);
    expect(sendSync.mock.calls[0]?.[1].engine).toBe('codex');
    expect(sendSync.mock.calls[0]?.[1].model).toBe('gpt-5.1-codex');
  });

  it('shows both Claude and fallback errors when prompt enhancement cannot recover', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync
      .mockRejectedValueOnce(new Error('Claude stream-json ended without a valid stream event'))
      .mockRejectedValueOnce(new Error('Codex response timed out'));

    const { result } = renderPromptEnhancer();

    act(() => {
      result.current.handleEnhancePrompt();
    });

    await waitFor(() => {
      expect(result.current.showEnhancerDialog).toBe(true);
    });

    act(() => {
      result.current.handleRunPromptEnhancement();
    });

    await waitFor(() => {
      expect(result.current.isEnhancing).toBe(false);
      expect(result.current.canUseEnhancedPrompt).toBe(false);
    });

    expect(result.current.enhancedPrompt).toContain(
      'Prompt enhancement failed: Claude stream-json ended without a valid stream event',
    );
    expect(result.current.enhancedPrompt).toContain(
      'Prompt enhancement failed: Codex response timed out',
    );
    expect(sendSync).toHaveBeenCalledTimes(2);
  });

  it('keeps Claude diagnostics when Codex fallback returns an empty rewrite', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync
      .mockRejectedValueOnce(new Error('Claude exited with status: exit status: 1'))
      .mockResolvedValueOnce({
        engine: 'codex',
        text: '   ',
      });

    const { result } = renderPromptEnhancer();

    act(() => {
      result.current.handleEnhancePrompt();
    });

    await waitFor(() => {
      expect(result.current.showEnhancerDialog).toBe(true);
    });

    act(() => {
      result.current.handleRunPromptEnhancement();
    });

    await waitFor(() => {
      expect(result.current.isEnhancing).toBe(false);
      expect(result.current.canUseEnhancedPrompt).toBe(false);
    });

    expect(result.current.enhancedPrompt).toContain(
      'Prompt enhancement failed: Claude exited with status',
    );
    expect(result.current.enhancedPrompt).toContain(
      'The engine returned an empty enhancement',
    );
    expect(sendSync).toHaveBeenCalledTimes(2);
  });

  it('shows workspace failure copy when the workspace is missing', () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    const { result } = renderPromptEnhancer({ workspaceId: null });

    act(() => {
      result.current.handleEnhancePrompt();
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });

    expect(result.current.enhancedPrompt).toBe(
      'Workspace is not ready for prompt enhancement',
    );
    expect(result.current.canUseEnhancedPrompt).toBe(false);
    expect(sendSync).not.toHaveBeenCalled();
  });

  it('serves a repeated enhancement from cache without a second engine call', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync.mockResolvedValue({
      engine: 'claude',
      text: '请说明报告管理页面标题加载逻辑。',
    });

    const { result } = renderPromptEnhancer();

    act(() => {
      result.current.handleEnhancePrompt();
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });

    await waitFor(() => {
      expect(result.current.canUseEnhancedPrompt).toBe(true);
    });
    expect(sendSync).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleCloseEnhancerDialog();
    });
    act(() => {
      result.current.handleEnhancePrompt();
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });

    await waitFor(() => {
      expect(result.current.canUseEnhancedPrompt).toBe(true);
    });
    expect(result.current.enhancedPrompt).toBe('请说明报告管理页面标题加载逻辑。');
    expect(result.current.isEnhancing).toBe(false);
    expect(sendSync).toHaveBeenCalledTimes(1);
  });

  it('does not reuse cached enhancements across intensity', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync
      .mockResolvedValueOnce({ engine: 'claude', text: 'light rewrite' })
      .mockResolvedValueOnce({ engine: 'claude', text: 'structured rewrite' });
    const { result } = renderPromptEnhancer();

    act(() => {
      result.current.handleEnhancePrompt();
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });
    await waitFor(() => {
      expect(result.current.enhancedPrompt).toBe('light rewrite');
    });
    act(() => {
      result.current.handleEnhancerIntensityChange('struct');
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });
    await waitFor(() => {
      expect(result.current.enhancedPrompt).toBe('structured rewrite');
    });
    expect(sendSync).toHaveBeenCalledTimes(2);
    expect(String(sendSync.mock.calls[0]?.[1].text)).toContain('Intensity: light polish');
    expect(String(sendSync.mock.calls[1]?.[1].text)).toContain('Intensity: structured');
  });

  it('does not reuse cached enhancements across workspaces', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync.mockImplementation(async (workspaceId) => ({
      engine: 'claude',
      text: `enhanced:${workspaceId}`,
    }));
    let workspaceId = 'ws-a';
    const { result, rerender } = renderHook(() =>
      usePromptEnhancer({
        workspaceId,
        editableRef: { current: null },
        getTextContent: () => 'same draft',
        currentProvider: 'claude',
        selectedModel: 'claude-sonnet-4-5',
        modelGroups: defaultModelGroups,
        setHasContent: vi.fn(),
        handleInput: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleEnhancePrompt();
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });
    await waitFor(() => {
      expect(result.current.enhancedPrompt).toBe('enhanced:ws-a');
    });
    act(() => {
      result.current.handleCloseEnhancerDialog();
    });

    workspaceId = 'ws-b';
    rerender();
    act(() => {
      result.current.handleEnhancePrompt();
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });
    await waitFor(() => {
      expect(result.current.enhancedPrompt).toBe('enhanced:ws-b');
    });

    expect(sendSync).toHaveBeenCalledTimes(2);
    expect(sendSync.mock.calls.map(([scope]) => scope)).toEqual(['ws-a', 'ws-b']);
  });

  it('invalidates an in-flight enhancement when the workspace changes', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    let resolveRequest!: (value: { engine: 'claude'; text: string }) => void;
    sendSync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    let workspaceId = 'ws-a';
    const { result, rerender } = renderHook(() =>
      usePromptEnhancer({
        workspaceId,
        editableRef: { current: null },
        getTextContent: () => 'same draft',
        currentProvider: 'claude',
        selectedModel: 'claude-sonnet-4-5',
        modelGroups: defaultModelGroups,
        setHasContent: vi.fn(),
        handleInput: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleEnhancePrompt();
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });
    await waitFor(() => {
      expect(result.current.isEnhancing).toBe(true);
    });

    workspaceId = 'ws-b';
    rerender();
    await waitFor(() => {
      expect(result.current.showEnhancerDialog).toBe(false);
      expect(result.current.isEnhancing).toBe(false);
    });

    resolveRequest({ engine: 'claude', text: 'stale workspace result' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.enhancedPrompt).toBe('');
    expect(result.current.canUseEnhancedPrompt).toBe(false);
  });

  it('does not cache failed enhancements and retries the engine', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync
      .mockRejectedValueOnce(new Error('some unrecoverable failure'))
      .mockResolvedValueOnce({
        engine: 'claude',
        text: '第二次重试后的润色结果。',
      });

    const { result } = renderPromptEnhancer();

    act(() => {
      result.current.handleEnhancePrompt();
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });

    await waitFor(() => {
      expect(result.current.canUseEnhancedPrompt).toBe(false);
    });
    expect(sendSync).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleCloseEnhancerDialog();
    });
    act(() => {
      result.current.handleEnhancePrompt();
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });

    await waitFor(() => {
      expect(result.current.canUseEnhancedPrompt).toBe(true);
    });
    expect(result.current.enhancedPrompt).toBe('第二次重试后的润色结果。');
    expect(sendSync).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest cache entry beyond the LRU cap', async () => {
    const sendSync = vi.mocked(engineSendMessageSync);
    sendSync.mockImplementation(async (_workspaceId, payload) => ({
      engine: 'claude',
      text: `enhanced:${payload.text.slice(-20)}`,
    }));

    let draft = 'draft-00';
    const { result } = renderHook(() =>
      usePromptEnhancer({
        workspaceId: 'ws-1',
        editableRef: { current: null },
        getTextContent: () => draft,
        currentProvider: 'claude',
        selectedModel: 'claude-sonnet-4-5',
        modelGroups: defaultModelGroups,
        setHasContent: vi.fn(),
        handleInput: vi.fn(),
      }),
    );

    // 填满 20 条缓存 + 1 条触发淘汰（draft-00 出局）。
    for (let index = 0; index <= 20; index += 1) {
      draft = `draft-${String(index).padStart(2, '0')}`;
      act(() => {
        result.current.handleEnhancePrompt();
      });
      act(() => {
        result.current.handleRunPromptEnhancement();
      });
      await waitFor(() => {
        expect(result.current.canUseEnhancedPrompt).toBe(true);
      });
      act(() => {
        result.current.handleCloseEnhancerDialog();
      });
    }
    expect(sendSync).toHaveBeenCalledTimes(21);

    // draft-20 仍在缓存：无新 IPC。
    draft = 'draft-20';
    act(() => {
      result.current.handleEnhancePrompt();
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });
    await waitFor(() => {
      expect(result.current.canUseEnhancedPrompt).toBe(true);
    });
    expect(sendSync).toHaveBeenCalledTimes(21);

    // draft-00 已被淘汰：重新调用引擎。
    draft = 'draft-00';
    act(() => {
      result.current.handleEnhancePrompt();
    });
    act(() => {
      result.current.handleRunPromptEnhancement();
    });
    await waitFor(() => {
      expect(result.current.canUseEnhancedPrompt).toBe(true);
    });
    expect(sendSync).toHaveBeenCalledTimes(22);
  });
});

describe('classifyPromptEnhancerError', () => {
  it('passes through an already structured error', () => {
    const typed = new PromptEnhancerError('timeout', 'prompt enhancement timed out after 60s', true);
    expect(classifyPromptEnhancerError(typed)).toBe(typed);
  });

  it('marks retryable engine failures via the central rule set', () => {
    const error = classifyPromptEnhancerError(new Error('Claude exited with status: exit status: 1'));
    expect(error.kind).toBe('engine');
    expect(error.retryable).toBe(true);
  });

  it('marks unknown engine failures as non-retryable', () => {
    const error = classifyPromptEnhancerError(new Error('some unrecoverable failure'));
    expect(error.kind).toBe('engine');
    expect(error.retryable).toBe(false);
  });

  it('normalizes non-error values', () => {
    expect(classifyPromptEnhancerError('boom').message).toBe('boom');
    expect(classifyPromptEnhancerError(undefined).message).toBe('unknown error');
  });
});

describe('resolveEnhancerLocale', () => {
  it('maps Chinese UI languages to the zh instruction', () => {
    expect(resolveEnhancerLocale('zh')).toBe('zh');
    expect(resolveEnhancerLocale('zh-TW')).toBe('zh');
  });

  it('falls back to English for other or missing languages', () => {
    expect(resolveEnhancerLocale('en')).toBe('en');
    expect(resolveEnhancerLocale('ja')).toBe('en');
    expect(resolveEnhancerLocale(undefined)).toBe('en');
  });
});

describe('buildPromptEnhancerInstruction', () => {
  it('builds the Chinese instruction for the zh locale', () => {
    const instruction = buildPromptEnhancerInstruction('原始草稿', 'claude', 'zh', 'light');
    expect(instruction).toContain('你是一名提示词改写助手。');
    expect(instruction).toContain('不要复述草稿');
    expect(instruction).toContain('强度：轻润色');
    expect(instruction).toContain('用户草稿：\n原始草稿');
    expect(instruction).not.toContain('最多输出 6 行短句');
  });

  it('changes rewrite strategy with intensity and forbids template restatement', () => {
    const structured = buildPromptEnhancerInstruction('draft text', 'codex', 'en', 'struct');
    expect(structured).toContain('Intensity: structured');
    expect(structured).toContain('Do not restate the same sentence under Goal / Context / Acceptance headings');
    expect(structured).toContain('User draft:\ndraft text');
    expect(structured).not.toContain('Output at most 6 short lines');
  });
});

describe('normalizeEnhancedPromptResponse', () => {
  it('collapses an exact duplicated rewrite block', () => {
    const duplicated = [
      '请检查登录重复提交。',
      '给出最小修复。',
      '',
      '请检查登录重复提交。',
      '给出最小修复。',
    ].join('\n');
    const normalized = normalizeEnhancedPromptResponse(duplicated);
    expect(normalized.match(/请检查登录重复提交/g)).toHaveLength(1);
  });

  it('collapses consecutive duplicated lines without a blank separator', () => {
    const duplicated = [
      '请检查登录重复提交。',
      '请检查登录重复提交。',
      '给出最小修复。',
    ].join('\n');
    expect(normalizeEnhancedPromptResponse(duplicated)).toBe(
      '请检查登录重复提交。给出最小修复。',
    );
  });
});

describe('resolveEnhancerModelForSend', () => {
  const dshGroups = [
    {
      providerId: 'dsh' as const,
      providerLabel: 'dsh',
      enabled: true,
      models: [
        { id: 'gork-zhu/grok-4.6', label: 'gork-zhu / grok-4.6', model: 'grok-4.6' },
        { id: 'kimi-coding/k3', label: 'kimi-coding / k3', model: 'k3' },
      ],
    },
    {
      providerId: 'claude' as const,
      providerLabel: 'claude',
      enabled: true,
      models: [{ id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', model: 'claude-sonnet-4-5' }],
    },
    {
      providerId: 'opencode' as const,
      providerLabel: 'opencode',
      enabled: true,
      models: [{ id: 'openai/gpt-5.3-codex', label: 'GPT-5.3 Codex', model: 'gpt-5.3-codex' }],
    },
  ];

  it('sends the DSH provider/model catalog id instead of the runtime short name', () => {
    expect(resolveEnhancerModelForSend(dshGroups, 'dsh', 'gork-zhu/grok-4.6')).toBe('gork-zhu/grok-4.6');
    expect(resolveEnhancerModelForSend(dshGroups, 'dsh', 'grok-4.6')).toBe('gork-zhu/grok-4.6');
  });

  it('refuses a bare DSH runtime name when no catalog row exists', () => {
    expect(resolveEnhancerModelForSend([], 'dsh', 'grok-4.6')).toBeNull();
  });

  it('keeps slash catalog ids for OpenCode/PI and runtime ids for Claude', () => {
    expect(resolveEnhancerModelForSend(dshGroups, 'opencode', 'openai/gpt-5.3-codex')).toBe(
      'openai/gpt-5.3-codex',
    );
    expect(
      resolveEnhancerModelForSend(
        [
          {
            providerId: 'pi',
            providerLabel: 'pi',
            enabled: true,
            models: [{ id: 'openai/gpt-5', label: 'gpt-5', model: 'gpt-5' }],
          },
        ],
        'pi',
        'gpt-5',
      ),
    ).toBe('openai/gpt-5');
    expect(resolveEnhancerModelForSend(dshGroups, 'claude', 'claude-sonnet-4-5')).toBe(
      'claude-sonnet-4-5',
    );
  });
});

describe('resolveVisibleEnhancerEngines', () => {
  it('omits vendor-disabled engines and Gemini', () => {
    expect(resolveVisibleEnhancerEngines(new Set(['kimi', 'gemini']))).toEqual([
      'claude',
      'codex',
      'grok',
      'opencode',
      'pi',
      'dsh',
    ]);
  });
});
