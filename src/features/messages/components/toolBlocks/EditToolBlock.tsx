/**
 * 单个编辑文件工具块组件
 * Edit Tool Block Component
 * 复用共享的 FileChangeRow —— 与 fileChange / 分组编辑同源同款。
 */
import { memo, useCallback, useMemo } from 'react';
import type { ConversationItem } from '../../../../types';
import {
  parseToolArgs,
  resolveToolStatus,
  asRecord,
  pickStringField,
  EDIT_PATH_KEYS,
  EDIT_OLD_KEYS,
  EDIT_NEW_KEYS,
  EDIT_CONTENT_KEYS,
} from './toolConstants';
import { computeDiff } from '../../../../utils/diff';
import {
  FileChangeRow,
  structuredDiffToLines,
  type FileChangeDiffPreview,
} from './FileChangeRow';

interface EditToolBlockProps {
  item: Extract<ConversationItem, { kind: 'tool' }>;
  onOpenDiffPath?: (path: string) => void;
}

export const EditToolBlock = memo(function EditToolBlock({
  item,
  onOpenDiffPath,
}: EditToolBlockProps) {
  const args = useMemo(() => parseToolArgs(item.detail), [item.detail]);
  const nestedInput = useMemo(() => asRecord(args?.input), [args]);
  const nestedArgs = useMemo(() => asRecord(args?.arguments), [args]);

  // Prefer structured changes[0] path when present (should be rare for this block;
  // multi-file fileChange is owned by GenericToolBlock / EditToolGroupBlock).
  const changePath =
    item.changes?.find((change) => Boolean(change.path?.trim()))?.path?.trim() ?? "";

  const filePath =
    pickStringField(args, nestedInput, nestedArgs, EDIT_PATH_KEYS) || changePath;

  const { diff, hasStructuredDiff } = useMemo(() => {
    if (!args && !nestedInput && !nestedArgs) {
      return { diff: { lines: [], additions: 0, deletions: 0 }, hasStructuredDiff: false };
    }

    const oldString = pickStringField(args, nestedInput, nestedArgs, EDIT_OLD_KEYS);
    const newString = pickStringField(args, nestedInput, nestedArgs, EDIT_NEW_KEYS);
    if (oldString || newString) {
      return { diff: computeDiff(oldString, newString), hasStructuredDiff: true };
    }

    const content = pickStringField(args, nestedInput, nestedArgs, EDIT_CONTENT_KEYS);
    if (content) {
      return { diff: computeDiff('', content), hasStructuredDiff: true };
    }

    return { diff: { lines: [], additions: 0, deletions: 0 }, hasStructuredDiff: false };
  }, [args, nestedArgs, nestedInput]);

  const status = resolveToolStatus(item.status, Boolean(item.output));
  const hasInlineDiff = hasStructuredDiff && diff.lines.length > 0;
  const canExpand = hasInlineDiff || Boolean(item.output);

  const loadDiff = useCallback(
    (): FileChangeDiffPreview => ({ lines: structuredDiffToLines(diff.lines) }),
    [diff.lines],
  );

  if (!filePath) {
    return null;
  }

  return (
    <FileChangeRow
      filePath={filePath}
      additions={diff.additions}
      deletions={diff.deletions}
      status={status}
      canExpand={canExpand}
      loadDiff={hasInlineDiff ? loadDiff : undefined}
      onOpenDiffPath={onOpenDiffPath}
      fallbackBody={
        !hasInlineDiff && item.output ? (
          <pre className="scrollable m-0 max-h-[300px] overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-xs text-muted-foreground">
            {item.output}
          </pre>
        ) : undefined
      }
    />
  );
});
