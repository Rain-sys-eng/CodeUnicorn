import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EngineType } from '../../../../types';
import { EngineIcon } from '../../../engine/components/EngineIcon';
import type { ModelInfo, ProviderId } from './types';
import type { ProviderModelGroup } from './modelOptions';
import { ModelSelect } from './selectors/ModelSelect';
import {
  PROMPT_ENHANCER_INTENSITY_OPTIONS,
  type PromptEnhancerIntensity,
} from './hooks/usePromptEnhancer';

interface PromptEnhancerDialogProps {
  isOpen: boolean;
  isLoading: boolean;
  loadingEngine: EngineType;
  selectedEngine: EngineType;
  selectedModel: string;
  selectedIntensity: PromptEnhancerIntensity;
  modelOptions: ModelInfo[];
  modelGroups: ProviderModelGroup[];
  visibleEngines: EngineType[];
  timeoutSeconds: number;
  timeoutLimits: {
    minSeconds: number;
    maxSeconds: number;
  };
  originalPrompt: string;
  enhancedPrompt: string;
  canUseEnhanced: boolean;
  onEngineChange: (engine: EngineType) => void;
  onModelChange: (modelId: string) => void;
  onProviderModelChange: (providerId: ProviderId, modelId: string) => void;
  onIntensityChange: (intensity: PromptEnhancerIntensity) => void;
  onTimeoutChange: (timeoutSeconds: number) => void;
  onOriginalPromptChange: (prompt: string) => void;
  onRunEnhancement: () => void;
  onUseEnhanced: () => void;
  onKeepOriginal: () => void;
  onClose: () => void;
}

function tokenizeForDiff(value: string): string[] {
  return value.split(/(\s+)/);
}

function renderEnhancedDiff(original: string, enhanced: string) {
  const originalTokens = new Set(tokenizeForDiff(original).filter((token) => token.trim().length > 0));
  return tokenizeForDiff(enhanced).map((token, index) => {
    if (!token.trim()) {
      return token;
    }
    const isNew = !originalTokens.has(token);
    return (
      <span key={token + '-' + index} className={isNew ? 'prompt-diff-add' : undefined}>
        {token}
      </span>
    );
  });
}

export const PromptEnhancerDialog = ({
  isOpen,
  isLoading,
  loadingEngine,
  selectedEngine,
  selectedModel,
  selectedIntensity,
  modelOptions,
  modelGroups,
  visibleEngines,
  timeoutSeconds,
  timeoutLimits,
  originalPrompt,
  enhancedPrompt,
  canUseEnhanced,
  onProviderModelChange,
  onIntensityChange,
  onTimeoutChange,
  onOriginalPromptChange,
  onRunEnhancement,
  onUseEnhanced,
  onKeepOriginal,
  onClose,
}: PromptEnhancerDialogProps) => {
  const { t } = useTranslation();
  const hasEnabledEngine = visibleEngines.length > 0;

  const intensityHint = useMemo(() => {
    switch (selectedIntensity) {
      case 'struct':
        return t('promptEnhancer.intensityStructHint', {
          defaultValue: 'Add sections only when they introduce new constraints',
        });
      case 'exec':
        return t('promptEnhancer.intensityExecHint', {
          defaultValue: 'Add actions and verification without inventing facts',
        });
      case 'light':
      default:
        return t('promptEnhancer.intensityLightHint', {
          defaultValue: 'Polish wording; do not expand a short draft',
        });
    }
  }, [selectedIntensity, t]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key !== 'Enter' || event.altKey || isLoading) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && canUseEnhanced) {
      event.preventDefault();
      onUseEnhanced();
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) {
      return;
    }
    if (canUseEnhanced) {
      event.preventDefault();
      onUseEnhanced();
      return;
    }
    if (originalPrompt.trim() && hasEnabledEngine) {
      event.preventDefault();
      onRunEnhancement();
    }
  }, [canUseEnhanced, hasEnabledEngine, isLoading, onClose, onRunEnhancement, onUseEnhanced, originalPrompt]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isLoading) {
      onClose();
    }
  };

  return (
    <div className="prompt-enhancer-overlay" onClick={handleOverlayClick}>
      <div className="prompt-enhancer-dialog prompt-enhancer-dialog--wide" onClick={(event) => event.stopPropagation()}>
        <div className="prompt-enhancer-header">
          <div className="prompt-enhancer-title">
            <span className="codicon codicon-sparkle" />
            <h3>{t('promptEnhancer.title')}</h3>
            <span className="prompt-enhancer-subtitle">
              {t('promptEnhancer.subtitle', { defaultValue: 'Side-by-side review' })}
            </span>
          </div>
          <button
            className="prompt-enhancer-close"
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <span className="codicon codicon-close" />
          </button>
        </div>

        <div className="prompt-enhancer-content">
          <div className="prompt-enhancer-toolbar" aria-label={t('promptEnhancer.runSettings')}>
            {hasEnabledEngine ? (
              <div className={isLoading ? 'prompt-enhancer-picker is-disabled' : 'prompt-enhancer-picker'}>
                <ModelSelect
                  value={selectedModel}
                  onChange={() => {}}
                  currentProvider={selectedEngine}
                  models={modelOptions}
                  modelGroups={modelGroups}
                  onProviderModelChange={onProviderModelChange}
                  menuLayer="overlay"
                />
              </div>
            ) : (
              <div className="prompt-enhancer-empty-engines">
                {t('promptEnhancer.noEnabledEngine', {
                  defaultValue: 'No enabled CLI. Enable an engine in vendor settings first.',
                })}
              </div>
            )}

            <div className="prompt-enhancer-modes" role="radiogroup" aria-label={t('promptEnhancer.intensityLabel')}>
              {PROMPT_ENHANCER_INTENSITY_OPTIONS.map((intensity) => (
                <button
                  key={intensity}
                  type="button"
                  role="radio"
                  aria-checked={selectedIntensity === intensity}
                  className={selectedIntensity === intensity ? 'prompt-enhancer-mode on' : 'prompt-enhancer-mode'}
                  onClick={() => onIntensityChange(intensity)}
                  disabled={isLoading}
                >
                  {t('promptEnhancer.intensity.' + intensity)}
                </button>
              ))}
            </div>

            <button
              className="prompt-enhancer-btn primary prompt-enhancer-run-btn"
              onClick={onRunEnhancement}
              disabled={isLoading || !originalPrompt.trim() || !hasEnabledEngine}
            >
              <span className={isLoading ? 'codicon codicon-loading' : 'codicon codicon-play'} />
              {t('promptEnhancer.runEnhancement')}
            </button>
          </div>

          <p className="prompt-enhancer-intensity-hint">{intensityHint}</p>

          <details className="prompt-enhancer-advanced">
            <summary>{t('promptEnhancer.advancedTimeout')}</summary>
            <label className="prompt-enhancer-field">
              <span>{t('promptEnhancer.timeoutSeconds')}</span>
              <input
                className="prompt-enhancer-timeout"
                type="number"
                min={timeoutLimits.minSeconds}
                max={timeoutLimits.maxSeconds}
                step={1}
                value={timeoutSeconds}
                onChange={(event) => onTimeoutChange(Number(event.target.value))}
                disabled={isLoading}
              />
            </label>
          </details>

          <div className="prompt-enhancer-split">
            <section className="prompt-section">
              <div className="prompt-section-header">
                <span className="codicon codicon-edit" />
                <span>{t('promptEnhancer.originalPrompt')}</span>
                <span className="prompt-section-meta">{t('promptEnhancer.originalEditable')}</span>
              </div>
              <textarea
                className="prompt-text original-prompt"
                value={originalPrompt}
                onChange={(event) => onOriginalPromptChange(event.target.value)}
                disabled={isLoading}
              />
            </section>

            <section className="prompt-section">
              <div className="prompt-section-header">
                <span className="codicon codicon-sparkle" />
                <span>{t('promptEnhancer.enhancedPrompt')}</span>
                <span className="prompt-section-meta">
                  {canUseEnhanced ? t('promptEnhancer.diffLegend') : t('promptEnhancer.waitingEnhance')}
                </span>
              </div>
              <div className="prompt-text enhanced-prompt">
                {isLoading ? (
                  <div className="prompt-loading">
                    <EngineIcon
                      engine={loadingEngine}
                      size={16}
                      className="prompt-loading-engine-icon"
                    />
                    <span>{t('promptEnhancer.enhancingWithEngine', { engine: loadingEngine })}</span>
                  </div>
                ) : canUseEnhanced ? (
                  renderEnhancedDiff(originalPrompt, enhancedPrompt)
                ) : (
                  enhancedPrompt || t('promptEnhancer.readyToEnhance')
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="prompt-enhancer-footer">
          <button
            className="prompt-enhancer-btn secondary"
            onClick={onKeepOriginal}
            disabled={isLoading}
          >
            <span className="codicon codicon-close" />
            {t('promptEnhancer.keepOriginal')}
          </button>
          <button
            className="prompt-enhancer-btn primary"
            onClick={onUseEnhanced}
            disabled={isLoading || !canUseEnhanced}
          >
            <span className="codicon codicon-check" />
            {t('promptEnhancer.useEnhanced')}
          </button>
        </div>
      </div>
    </div>
  );
};
