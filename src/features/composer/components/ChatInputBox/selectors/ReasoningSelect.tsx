import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CheckIcon from 'lucide-react/dist/esm/icons/check';
import { REASONING_LEVELS, type ReasoningEffort } from '../types';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';

interface ReasoningSelectProps {
  value: ReasoningEffort | null;
  onChange: (effort: ReasoningEffort | null) => void;
  options?: ReasoningEffort[];
  showDefaultOption?: boolean;
  defaultLabel?: string;
  disabled?: boolean;
  /**
   * When true, render as a DropdownMenuSub for the vertical tool menu
   * instead of a standalone button + popover.
   */
  inline?: boolean;
}

/**
 * ReasoningSelect - runtime reasoning effort selector.
 * Controls the depth of reasoning for engines that expose an effort option.
 */
export const ReasoningSelect = memo(({
  value,
  onChange,
  options,
  showDefaultOption = false,
  defaultLabel,
  disabled,
  inline = false,
}: ReasoningSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const visibleLevels = REASONING_LEVELS.filter((level) => {
    if (options === undefined) {
      return true;
    }
    return options.includes(level.id);
  });
  const fallbackLevel = visibleLevels[0] ?? REASONING_LEVELS[0] ?? {
    id: 'medium' as ReasoningEffort,
    label: 'Medium',
    icon: 'codicon-circle-filled',
    description: 'Balanced thinking',
  };

  const currentLevel = value
    ? REASONING_LEVELS.find(l => l.id === value) ?? fallbackLevel
    : null;
  const resolvedDefaultLabel =
    defaultLabel ?? t('reasoning.default', { defaultValue: 'Default' });

  /**
   * Get translated text for reasoning level
   */
  const getReasoningText = (levelId: ReasoningEffort, field: 'label' | 'description') => {
    const key = `reasoning.${levelId}.${field}`;
    const fallback = REASONING_LEVELS.find(l => l.id === levelId)?.[field] || levelId;
    return t(key, { defaultValue: fallback });
  };
  const triggerLabel = currentLevel ? getReasoningText(currentLevel.id, 'label') : resolvedDefaultLabel;
  const triggerIcon = currentLevel?.icon ?? 'codicon-lightbulb';

  /**
   * Select reasoning level
   */
  const handleSelect = useCallback((effort: ReasoningEffort | null) => {
    onChange(effort);
    setIsOpen(false);
  }, [onChange]);

  if (inline) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="composer-tool-menu-sub-trigger">
          <span className={`codicon ${triggerIcon} composer-tool-menu-item-icon`} aria-hidden="true" />
          <span className="composer-tool-menu-item-body">
            <span className="composer-tool-menu-item-label">
              {t('reasoning.title', { defaultValue: '推理深度' })}
            </span>
            <span className="composer-tool-menu-item-value">{triggerLabel}</span>
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="composer-tool-menu-sub-content">
          {showDefaultOption && (
            <button
              type="button"
              className={`composer-tool-menu-option${value === null ? ' is-selected' : ''}`}
              onClick={() => handleSelect(null)}
              title={t('reasoning.defaultDescription', {
                defaultValue: 'Use the engine default reasoning behavior',
              })}
            >
              <span className="codicon codicon-circle-outline composer-tool-menu-option-icon" aria-hidden="true" />
              <span className="composer-tool-menu-option-body">
                <span className="composer-tool-menu-option-label">{resolvedDefaultLabel}</span>
                <span className="composer-tool-menu-option-description">
                  {t('reasoning.defaultDescription', {
                    defaultValue: 'Use the engine default reasoning behavior',
                  })}
                </span>
              </span>
              {value === null && (
                <span className="codicon codicon-check composer-tool-menu-option-check" aria-hidden="true" />
              )}
            </button>
          )}
          {visibleLevels.map((level) => (
            <button
              key={level.id}
              type="button"
              className={`composer-tool-menu-option${level.id === value ? ' is-selected' : ''}`}
              onClick={() => handleSelect(level.id)}
              title={getReasoningText(level.id, 'description')}
            >
              <span className={`codicon ${level.icon} composer-tool-menu-option-icon`} aria-hidden="true" />
              <span className="composer-tool-menu-option-body">
                <span className="composer-tool-menu-option-label">{getReasoningText(level.id, 'label')}</span>
                <span className="composer-tool-menu-option-description">
                  {getReasoningText(level.id, 'description')}
                </span>
              </span>
              {level.id === value && (
                <span className="codicon codicon-check composer-tool-menu-option-check" aria-hidden="true" />
              )}
            </button>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <div className="selector-reasoning-wrap" style={{ position: 'relative', display: 'inline-block' }}>
      <DropdownMenu
        open={isOpen}
        onOpenChange={(next) => {
          if (disabled) return;
          setIsOpen(next);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            className="selector-button selector-reasoning-button"
            disabled={disabled}
            aria-label={triggerLabel}
            title={t('reasoning.title', { defaultValue: 'Select reasoning depth' })}
          >
            <span className={`codicon ${triggerIcon}`} />
            <span className="selector-button-text">{triggerLabel}</span>
            <span
              className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'}`}
              style={{ fontSize: '10px', marginLeft: '2px' }}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" sideOffset={4} className="w-64">
          {showDefaultOption && (
            <DropdownMenuItem
              data-reasoning-id="default"
              data-selected={value === null ? 'true' : undefined}
              onSelect={(event) => {
                event.preventDefault();
                handleSelect(null);
              }}
              title={t('reasoning.defaultDescription', {
                defaultValue: 'Use the engine default reasoning behavior',
              })}
              className="items-start gap-2"
            >
              <span className="codicon codicon-circle-outline mt-0.5 shrink-0" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{resolvedDefaultLabel}</span>
                <span className="text-xs text-muted-foreground whitespace-normal">
                  {t('reasoning.defaultDescription', {
                    defaultValue: 'Use the engine default reasoning behavior',
                  })}
                </span>
              </div>
              {value === null && <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />}
            </DropdownMenuItem>
          )}
          {visibleLevels.map((level) => (
            <DropdownMenuItem
              key={level.id}
              data-reasoning-id={level.id}
              data-selected={level.id === value ? 'true' : undefined}
              onSelect={(event) => {
                event.preventDefault();
                handleSelect(level.id);
              }}
              title={getReasoningText(level.id, 'description')}
              className="items-start gap-2"
            >
              <span className={`codicon ${level.icon} mt-0.5 shrink-0`} aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{getReasoningText(level.id, 'label')}</span>
                <span className="text-xs text-muted-foreground whitespace-normal">
                  {getReasoningText(level.id, 'description')}
                </span>
              </div>
              {level.id === value && <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
