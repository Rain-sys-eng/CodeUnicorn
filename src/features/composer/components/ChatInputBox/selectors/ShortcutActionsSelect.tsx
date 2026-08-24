import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShortcutAction } from '../types';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

interface ShortcutActionsSelectProps {
  actions?: ShortcutAction[];
  /**
   * When true, render as DropdownMenuItem rows for the vertical tool menu
   * instead of a standalone button + popover (Radix owns focus/keyboard).
   */
  inline?: boolean;
}

export const ShortcutActionsSelect = ({ actions, inline = false }: ShortcutActionsSelectProps) => {
  const { t } = useTranslation();
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasActions = Boolean(actions && actions.length > 0);
  const actionCount = actions?.length ?? 0;

  const focusItemByIndex = useCallback((index: number) => {
    if (actionCount === 0) {
      return;
    }
    const normalizedIndex = ((index % actionCount) + actionCount) % actionCount;
    itemRefs.current[normalizedIndex]?.focus();
  }, [actionCount]);

  const handleToggle = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    if (!hasActions) {
      return;
    }
    setIsOpen((prev) => !prev);
  }, [hasActions]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !hasActions) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasActions, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      focusItemByIndex(0);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [focusItemByIndex, isOpen]);

  const closeMenuAndFocusTrigger = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  const handleTriggerKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!hasActions) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      const targetIndex = event.key === 'ArrowUp' ? actionCount - 1 : 0;
      window.setTimeout(() => {
        focusItemByIndex(targetIndex);
      }, 0);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
    }
  }, [actionCount, focusItemByIndex, hasActions]);

  const handleItemKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!hasActions) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItemByIndex(index + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItemByIndex(index - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusItemByIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusItemByIndex(actionCount - 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenuAndFocusTrigger();
    }
  }, [actionCount, closeMenuAndFocusTrigger, focusItemByIndex, hasActions]);

  if (!hasActions) {
    return null;
  }

  if (inline) {
    return (
      <>
        {actions?.map((action) => (
          <DropdownMenuItem
            key={action.key}
            className="composer-tool-menu-action"
            onSelect={() => action.onClick()}
          >
            <span className="codicon codicon-zap composer-tool-menu-item-icon" aria-hidden="true" />
            <span className="composer-tool-menu-action-label">{action.label}</span>
            <span className="composer-tool-menu-action-trigger">{action.trigger}</span>
          </DropdownMenuItem>
        ))}
      </>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        className="selector-button selector-shortcut-button"
        onClick={handleToggle}
        onKeyDown={handleTriggerKeyDown}
        title={t('chat.shortcutActionsEntry')}
        aria-label={t('chat.shortcutActionsEntry')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
      >
        <span className="codicon codicon-zap" />
      </button>

      {isOpen && (
        <div
          id={menuId}
          ref={dropdownRef}
          className="selector-dropdown"
          role="menu"
          aria-label={t('chat.shortcutActionsAriaLabel')}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: '4px',
            zIndex: 10000,
            minWidth: '220px',
          }}
        >
          {actions?.map((action, index) => (
            <button
              type="button"
              key={action.key}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              role="menuitem"
              className="selector-option selector-option-shortcut selector-option-button selector-option-shortcut-button"
              onKeyDown={(event) => {
                handleItemKeyDown(event, index);
              }}
              onClick={(event) => {
                event.stopPropagation();
                action.onClick();
                closeMenuAndFocusTrigger();
              }}
            >
              <span className="selector-shortcut-trigger">{action.trigger}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
