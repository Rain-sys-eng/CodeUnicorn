import type { DropdownItemData } from '../types';
import i18n from '../../../i18n/config';

export interface PromptItem {
  id: string;
  name: string;
  content: string;
  description?: string;
  scopeLabel?: string;
  argumentHint?: string;
  argumentHintLabel?: string;
  usageCount?: number;
  heatLevel?: 0 | 1 | 2 | 3;
  kind?: 'prompt' | 'create' | 'empty';
}

export const CREATE_NEW_PROMPT_ID = '__create_new__';
export const EMPTY_STATE_ID = '__empty_state__';

export async function promptProvider(
  _query: string,
  signal: AbortSignal,
): Promise<PromptItem[]> {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  return [
    {
      id: EMPTY_STATE_ID,
      name: i18n.t('settings.prompt.noPromptsDropdown'),
      content: '',
      kind: 'empty',
    },
    {
      id: CREATE_NEW_PROMPT_ID,
      name: i18n.t('settings.prompt.createPrompt'),
      content: '',
      kind: 'create',
    },
  ];
}

export function promptToDropdownItem(prompt: PromptItem): DropdownItemData {
  if (prompt.id === EMPTY_STATE_ID) {
    return {
      id: prompt.id,
      label: prompt.name,
      description: prompt.content,
      icon: 'codicon-info',
      type: 'info',
      data: { prompt },
    };
  }

  if (prompt.id === CREATE_NEW_PROMPT_ID) {
    return {
      id: prompt.id,
      label: prompt.name,
      description: i18n.t('settings.prompt.createPromptHint'),
      icon: 'codicon-add',
      type: 'prompt',
      data: { prompt, promptKind: 'create', heatLevel: 0, usageCount: 0 },
    };
  }

  return {
    id: prompt.id,
    label: prompt.name,
    description: prompt.description
      ? prompt.description
      : prompt.content
        ? (prompt.content.length > 60 ? `${prompt.content.substring(0, 60)}...` : prompt.content)
        : undefined,
    icon: 'codicon-bookmark',
    type: 'prompt',
    data: {
      prompt,
      promptKind: prompt.kind ?? 'prompt',
      heatLevel: prompt.heatLevel ?? 0,
      usageCount: prompt.usageCount ?? 0,
      scopeLabel: prompt.scopeLabel,
      argumentHint: prompt.argumentHint,
      argumentHintLabel: prompt.argumentHintLabel,
    },
  };
}
