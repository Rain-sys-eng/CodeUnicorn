/**
 * 单文件变更行 - 全站文件变更的统一渲染单元
 * Shared single file-change row. One component behind EditToolBlock、
 * EditToolGroupBlock 与 GenericToolBlock 的 fileChange 分支，确保实时/历史、
 * 单文件/多文件/分组处处像素与行为一致。
 * 口径：ToolMarkerShell（单色 FilePen + kind「修改」+ 彩色文件类型图标 + 文件名 + 绿/红统计 + 靠右状态 + 折叠 diff 体）。
 */
import { memo, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import FilePen from 'lucide-react/dist/esm/icons/file-pen';
import { parseDiff } from '../../../../utils/diff';
import type { DiffLine } from '../../../../utils/diff';
import { getFileName, type ToolStatusTone } from './toolConstants';
import {
  ToolMarkerShell,
  ToolStatusIcon,
  TOOL_MARKER_BODY_CLASS,
} from './ToolMarkerShell';
import { ToolFileTypeIcon } from './ToolFileTypeIcon';

/** 中性 diff 行表示：各调用方把自己的 diff（computeDiff / parseDiff）归一到此形态 */
export type FileChangeDiffLine = {
  kind: 'add' | 'del' | 'hunk' | 'context';
  text: string;
};

export type FileChangeDiffPreview = {
  lines: FileChangeDiffLine[];
  truncated?: boolean;
};

const DEFAULT_DIFF_PREVIEW_MAX_LINES = 48;

/** computeDiff 的结构化行（unchanged/deleted/added）→ 共享中性行。 */
export function structuredDiffToLines(lines: DiffLine[]): FileChangeDiffLine[] {
  return lines.map((line) => ({
    kind:
      line.type === 'deleted' ? 'del' : line.type === 'added' ? 'add' : 'context',
    text: line.content,
  }));
}

/** unified diff 文本（parseDiff）→ 共享中性预览（含预览行数截断）。 */
export function unifiedDiffToPreview(
  diffText: string,
  maxLines = DEFAULT_DIFF_PREVIEW_MAX_LINES,
): FileChangeDiffPreview {
  const parsed = parseDiff(diffText);
  const parsedLines = parsed.some((line) => line.type !== 'hunk' && line.type !== 'meta')
    ? parsed
    : parseApplyPatchFileBody(diffText);
  const truncated = parsedLines.length > maxLines;
  const visible = truncated ? parsedLines.slice(0, maxLines) : parsedLines;
  return {
    lines: visible.map(
      (line): FileChangeDiffLine => ({
        kind:
          line.type === 'add'
            ? 'add'
            : line.type === 'del'
              ? 'del'
              : line.type === 'hunk' || line.type === 'meta'
                ? 'hunk'
                : 'context',
        text: line.text,
      }),
    ),
    truncated,
  };
}

function parseApplyPatchFileBody(diffText: string): ReturnType<typeof parseDiff> {
  const lines = diffText.split(/\r?\n/);
  const fileHeaderIndex = lines.findIndex((line) =>
    /^\*\*\* (?:Add|Delete) File: /.test(line.trim()),
  );
  if (fileHeaderIndex < 0) {
    return [];
  }

  const parsed: ReturnType<typeof parseDiff> = [];
  for (const line of lines.slice(fileHeaderIndex + 1)) {
    if (line.trim().startsWith('*** ')) {
      break;
    }
    if (line.startsWith('+')) {
      parsed.push({ type: 'add', oldLine: null, newLine: null, text: line.slice(1) });
    } else if (line.startsWith('-')) {
      parsed.push({ type: 'del', oldLine: null, newLine: null, text: line.slice(1) });
    }
  }
  return parsed;
}

interface FileChangeRowProps {
  filePath: string;
  additions: number;
  deletions: number;
  status: ToolStatusTone;
  /** 是否可展开（有 diff 预览或回退内容时为真）。为假时渲染纯展示行 */
  canExpand?: boolean;
  /** 懒加载 diff 预览：仅在该行展开时调用（保护「折叠态不解析 diff」的性能守卫） */
  loadDiff?: () => FileChangeDiffPreview;
  /** 展开后无 diff 预览时的回退展开体（如原始工具输出） */
  fallbackBody?: ReactNode;
  /**
   * inline diff 缺失时的 canonical Git diff fallback。
   * 调用方负责限定可 fallback 的 change kind；有 inline diff 时始终优先展开本行。
   */
  onOpenDiffPath?: (path: string) => void;
  defaultExpanded?: boolean;
  wrapperClassName?: string;
}

function renderDiffLines(
  preview: FileChangeDiffPreview,
  truncatedLabel: string,
): ReactNode {
  // hunk 头（@@ …@@）不在内联预览中展示——去掉顶部噪音区。
  const lines = preview.lines.filter((line) => line.kind !== 'hunk');
  return (
    <div className="tool-change-inline-diff edit-diff-viewer">
      {lines.map((line, index) => {
        const lineClass =
          line.kind === 'del'
            ? 'is-deleted'
            : line.kind === 'add'
              ? 'is-added'
              : '';
        const signNode =
          line.kind === 'del' ? '-' : line.kind === 'add' ? '+' : ' ';
        return (
          <div
            key={`${line.kind}-${index}`}
            className={`edit-diff-line ${lineClass}`}
          >
            <div className="edit-diff-gutter" />
            <div className={`edit-diff-sign ${lineClass}`}>{signNode}</div>
            <pre className="edit-diff-content">{line.text}</pre>
          </div>
        );
      })}
      {preview.truncated && (
        <div className="tool-change-inline-diff-truncated">{truncatedLabel}</div>
      )}
    </div>
  );
}

export const FileChangeRow = memo(function FileChangeRow({
  filePath,
  additions,
  deletions,
  status,
  canExpand = false,
  loadDiff,
  fallbackBody,
  onOpenDiffPath,
  defaultExpanded = false,
  wrapperClassName,
}: FileChangeRowProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const fileName = getFileName(filePath) || filePath;
  const hasStats = additions > 0 || deletions > 0;

  // 仅在展开时解析 diff —— 折叠态不触发解析，保持性能守卫。
  const preview = useMemo(
    () => (expanded && loadDiff ? loadDiff() : null),
    [expanded, loadDiff],
  );
  const hasDiff = (preview?.lines.length ?? 0) > 0;
  const canOpenMissingDiff = !canExpand && Boolean(onOpenDiffPath);

  const handleToggle = () => {
    if (canExpand) {
      setExpanded((prev) => !prev);
      return;
    }
    if (!onOpenDiffPath) {
      return;
    }
    try {
      void Promise.resolve(onOpenDiffPath(filePath)).catch(() => undefined);
    } catch {
      // Host navigation 的同步/异步失败都不能破坏 conversation surface。
    }
  };

  const body = canExpand ? (
    <div className={TOOL_MARKER_BODY_CLASS}>
      {hasDiff && preview
        ? renderDiffLines(preview, t('tools.diffTruncated'))
        : fallbackBody}
    </div>
  ) : undefined;

  // 行首用与「批量修改」组头同款的单色动作 icon（FilePen），非彩色文件类型 icon
  // 彩色文件类型 icon 放在 kind 之后、文件名之前
  return (
    <ToolMarkerShell
      kind={t('tools.kindEdit')}
      icon={<FilePen size={14} aria-hidden />}
      label={t('tools.editFile')}
      labelHidden
      wrapperClassName={wrapperClassName}
      interactive={canExpand || canOpenMissingDiff}
      expanded={expanded}
      onToggle={canExpand || canOpenMissingDiff ? handleToggle : undefined}
      trailing={<ToolStatusIcon status={status} />}
      body={body}
    >
      {filePath ? (
        <span className="tool-marker-file-type-icon inline-flex shrink-0" aria-hidden>
          <ToolFileTypeIcon filePath={filePath} size={14} />
        </span>
      ) : null}
      <span className="tool-meta-path min-w-0 truncate" title={filePath}>
        {fileName}
      </span>
      {hasStats && (
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          {additions > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
          )}
          {deletions > 0 && (
            <span className="text-red-500 dark:text-red-400">-{deletions}</span>
          )}
        </span>
      )}
    </ToolMarkerShell>
  );
});
