/**
 * 批量读取文件分组组件
 * Groups multiple consecutive Read tool calls into a collapsible file list
 * 复用 ExploreInlineToolGroup（与批量搜索等同构）
 */
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import type { ConversationItem } from '../../../../types';
import {
  extractToolName,
  parseToolArgs,
  getFirstStringField,
  getFileName,
} from './toolConstants';
import { ExploreInlineItemRow, ExploreInlineToolGroup } from './ExploreInlineToolGroup';
import { ToolFileTypeIcon } from './ToolFileTypeIcon';

type ToolItem = Extract<ConversationItem, { kind: 'tool' }>;

interface ReadToolGroupBlockProps {
  items: ToolItem[];
}

interface ParsedReadItem {
  id: string;
  fileName: string;
  filePath: string;
  isDirectory: boolean;
  lineInfo: string;
}

const FILE_PATH_KEYS = [
  'file_path',
  'filePath',
  'filepath',
  'path',
  'target_file',
  'targetFile',
  'filename',
  'file',
];
const DIRECTORY_PATH_KEYS = [
  'target_directory',
  'targetDirectory',
  'directory',
  'dir',
];
const LIST_KEYS = ['files', 'file_paths', 'filePaths', 'paths'];
const DIRECTORY_TOOL_NAMES = new Set([
  'list_dir',
  'listdir',
  'list_directory',
  'ls',
  'list',
  'list_files',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getFirstStringInArray(source: Record<string, unknown> | null, keys: string[]): string {
  if (!source) return '';
  for (const key of keys) {
    const value = source[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) {
        return entry.trim();
      }
    }
  }
  return '';
}

function parseReadItem(item: ToolItem): ParsedReadItem {
  const args = parseToolArgs(item.detail);
  const nestedInput = asRecord(args?.input);
  const nestedArgs = asRecord(args?.arguments);
  const directoryPath =
    getFirstStringField(args, DIRECTORY_PATH_KEYS) ||
    getFirstStringField(nestedInput, DIRECTORY_PATH_KEYS) ||
    getFirstStringField(nestedArgs, DIRECTORY_PATH_KEYS);
  const filePath =
    getFirstStringField(args, FILE_PATH_KEYS) ||
    getFirstStringField(nestedInput, FILE_PATH_KEYS) ||
    getFirstStringField(nestedArgs, FILE_PATH_KEYS) ||
    directoryPath ||
    getFirstStringInArray(args, LIST_KEYS) ||
    getFirstStringInArray(nestedInput, LIST_KEYS) ||
    getFirstStringInArray(nestedArgs, LIST_KEYS);
  const fileName = getFileName(filePath);
  const isDirectory =
    Boolean(directoryPath) ||
    DIRECTORY_TOOL_NAMES.has(extractToolName(item.title)) ||
    filePath === '.' ||
    filePath === '..' ||
    (filePath?.endsWith('/') ?? false);

  const offset = args?.offset as number | undefined;
  const limit = args?.limit as number | undefined;
  let lineInfo = '';
  if (typeof offset === 'number' && typeof limit === 'number') {
    lineInfo = `L${offset + 1}-${offset + limit}`;
  }

  return { id: item.id, fileName, filePath, isDirectory, lineInfo };
}

export const ReadToolGroupBlock = memo(function ReadToolGroupBlock({
  items,
}: ReadToolGroupBlockProps) {
  const { t } = useTranslation();

  const parsed = useMemo(() => items.map(parseReadItem), [items]);

  if (parsed.length === 0) return null;

  const title = t('tools.batchReadFile', { count: parsed.length });

  return (
    <ExploreInlineToolGroup
      icon={<FileText size={14} aria-hidden />}
      title={title}
    >
      {parsed.map((entry) => (
        <ExploreInlineItemRow
          key={entry.id}
          kind={entry.isDirectory ? t('tools.kindList') : t('tools.kindRead')}
          icon={
            entry.filePath ? (
              <ToolFileTypeIcon
                filePath={entry.filePath}
                isFolder={entry.isDirectory}
                size={14}
              />
            ) : undefined
          }
          label={entry.fileName || entry.filePath || '...'}
          detail={entry.lineInfo || undefined}
          title={entry.filePath}
        />
      ))}
    </ExploreInlineToolGroup>
  );
});
