/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptEnhancerDialog } from './PromptEnhancerDialog';

vi.mock('./selectors/ModelSelect', () => ({
  ModelSelect: ({ currentProvider, menuLayer, onProviderModelChange }: {
    currentProvider?: string;
    menuLayer?: string;
    onProviderModelChange?: (providerId: string, modelId: string) => void;
  }) => (
    <button
      type="button"
      data-testid="enhancer-model-select"
      onClick={() => onProviderModelChange?.('codex', 'gpt-5.6-sol')}
    >
      {currentProvider}:{menuLayer ?? 'default'}
    </button>
  ),
}));

const modelGroups = [
  {
    providerId: 'claude' as const,
    providerLabel: 'claude',
    enabled: true,
    models: [{ id: 'claude-sonnet-4-7', label: 'Sonnet 4.7' }],
  },
];

function renderDialog(overrides: Partial<Parameters<typeof PromptEnhancerDialog>[0]> = {}) {
  const props = {
    isOpen: true,
    isLoading: false,
    loadingEngine: 'claude' as const,
    selectedEngine: 'claude' as const,
    selectedModel: 'claude-sonnet-4-7',
    selectedIntensity: 'light' as const,
    modelOptions: modelGroups[0].models,
    modelGroups,
    visibleEngines: ['claude' as const],
    timeoutSeconds: 60,
    timeoutLimits: { minSeconds: 5, maxSeconds: 300 },
    originalPrompt: '帮我优化登录',
    enhancedPrompt: '',
    canUseEnhanced: false,
    onEngineChange: vi.fn(),
    onModelChange: vi.fn(),
    onProviderModelChange: vi.fn(),
    onIntensityChange: vi.fn(),
    onTimeoutChange: vi.fn(),
    onOriginalPromptChange: vi.fn(),
    onRunEnhancement: vi.fn(),
    onUseEnhanced: vi.fn(),
    onKeepOriginal: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<PromptEnhancerDialog {...props} />);
  return props;
}

describe('PromptEnhancerDialog', () => {
  it('uses Composer ModelSelect and intensity controls', () => {
    const props = renderDialog();
    expect(screen.getByTestId('enhancer-model-select').textContent).toBe('claude:overlay');
    fireEvent.click(screen.getByRole('radio', { name: 'promptEnhancer.intensity.struct' }));
    expect(props.onIntensityChange).toHaveBeenCalledWith('struct');
    fireEvent.click(screen.getByTestId('enhancer-model-select'));
    expect(props.onProviderModelChange).toHaveBeenCalledWith('codex', 'gpt-5.6-sol');
  });

  it('blocks enhancement when no CLI is enabled', () => {
    const props = renderDialog({ visibleEngines: [] });
    expect(
      screen.getByText('No enabled CLI. Enable an engine in vendor settings first.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /promptEnhancer.runEnhancement/ })).toHaveProperty('disabled', true);
    expect(props.onRunEnhancement).not.toHaveBeenCalled();
  });

  it('shows added tokens after a successful rewrite', () => {
    renderDialog({
      canUseEnhanced: true,
      enhancedPrompt: '帮我优化登录 消除重复提交',
    });
    expect(document.querySelector('.prompt-diff-add')?.textContent).toBe('消除重复提交');
  });

  it('adopts the rewrite with Cmd+Enter and starts enhancement with Enter', () => {
    const ready = renderDialog({ canUseEnhanced: true, enhancedPrompt: '改写后的登录提示' });
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(ready.onUseEnhanced).toHaveBeenCalledTimes(1);
    cleanup();

    const waiting = renderDialog({ canUseEnhanced: false, enhancedPrompt: '' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(waiting.onRunEnhancement).toHaveBeenCalledTimes(1);
  });
});
