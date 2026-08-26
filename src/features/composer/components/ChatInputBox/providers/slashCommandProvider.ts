import type { CommandItem, DropdownItemData } from '../types';
import i18n from '../../../i18n/config';

function getLocalNewSessionCommands(): CommandItem[] {
  return [{
    id: 'clear',
    label: '/clear',
    description: i18n.t('chat.clearCommandDescription'),
    category: 'system',
  }];
}

function filterCommands(commands: CommandItem[], query: string): CommandItem[] {
  if (!query) {
    return commands;
  }
  const lowerQuery = query.toLowerCase();
  return commands.filter((command) =>
    command.label.toLowerCase().includes(lowerQuery) ||
    command.description?.toLowerCase().includes(lowerQuery) ||
    command.id.toLowerCase().includes(lowerQuery)
  );
}

export async function slashCommandProvider(
  query: string,
  signal: AbortSignal,
): Promise<CommandItem[]> {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  return filterCommands(getLocalNewSessionCommands(), query);
}

export function commandToDropdownItem(command: CommandItem): DropdownItemData {
  return {
    id: command.id,
    label: command.label,
    description: command.description,
    icon: 'codicon-terminal',
    type: 'command',
    data: { command },
  };
}
