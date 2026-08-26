/**
 * 批量命令执行分组组件（时间线布局）
 * Groups multiple consecutive Bash tool calls into a timeline view
 * 统一 Marker 风格折叠行：灰色描边图标 + 批量标题 + 进度；展开体为命令时间线
 */
import { memo, useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Terminal from 'lucide-react/dist/esm/icons/terminal';
import type { ConversationItem } from '../../../../types';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { highlightLine } from '../../../../utils/syntax';
import {
  buildCommandSummary,
  parseToolArgs,
  getFirstStringField,
  truncateText,
  resolveToolStatus,
  type ToolStatusTone,
  asRecord,
  getFirstCommandField,
} from './toolConstants';
import { ToolMarkerShell } from './ToolMarkerShell';

type ToolItem = Extract<ConversationItem, { kind: 'tool' }>;

interface BashToolGroupBlockProps {
  items: ToolItem[];
  onRequestAutoScroll?: () => void;
}

interface ParsedBashItem {
  id: string;
  command: string;
  description: string;
  displayText: string;
  output: string;
  status: ToolStatusTone;
}

const MAX_VISIBLE_ITEMS = 3.5;
const ITEM_HEIGHT = 32;
const EXPANDED_MAX_HEIGHT = 400;
const MAX_OUTPUT_LINES = 100;
const ERROR_LINE_PATTERN = /(?:\berror\b|\bfailed\b|\bexception\b)/i;

function cleanCommand(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  const shellMatch = trimmed.match(
    /^(?:\/\S+\/)?(?:bash|zsh|sh|fish)(?:\.exe)?\s+-(?:l?c)\s+(['"])([\s\S]+)\1$/,
  );
  const inner = shellMatch ? (shellMatch[2] ?? trimmed) : trimmed;
  const cdMatch = inner.match(/^\s*cd\s+[^&;]+(?:\s*&&\s*|\s*;\s*)([\s\S]+)$/i);
  return (cdMatch ? (cdMatch[1] ?? inner) : inner).trim();
}

function parseBashItem(
  item: ToolItem,
  commandFallback: string,
): ParsedBashItem {
  const args = parseToolArgs(item.detail);
  const nestedInput = asRecord(args?.input);
  const nestedArgs = asRecord(args?.arguments);
  const commandKeys = ['command', 'cmd', 'script', 'shell_command', 'bash', 'argv'];
  const descriptionKeys = ['description', 'summary', 'label', 'title', 'task'];
  const commandFromArgs =
    getFirstCommandField(args, commandKeys) ||
    getFirstCommandField(nestedInput, commandKeys) ||
    getFirstCommandField(nestedArgs, commandKeys);
  const summaryCommand = buildCommandSummary(item, { includeDetail: false });
  const command = cleanCommand(commandFromArgs || summaryCommand);
  const description =
    getFirstStringField(args, descriptionKeys) ||
    getFirstStringField(nestedInput, descriptionKeys) ||
    getFirstStringField(nestedArgs, descriptionKeys);
  const displayText = truncateText(description || command, 60) || commandFallback;
  const output = item.output ?? '';
  const status = resolveToolStatus(item.status, Boolean(item.output));

  return { id: item.id, command, description, displayText, output, status };
}

export const BashToolGroupBlock = memo(function BashToolGroupBlock({
  items,
  onRequestAutoScroll,
}: BashToolGroupBlockProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(
    () =>
      items.some(
        (entry) =>
          resolveToolStatus(entry.status, Boolean(entry.output)) === "processing",
      ),
  );
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [copiedOutputId, setCopiedOutputId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const prevCountRef = useRef(items.length);
  const wasProcessingRef = useRef(false);

  const parsed = useMemo(
    () => items.map((item) => parseBashItem(item, t('tools.commandLabel'))),
    [items, t],
  );
  const totalCount = parsed.length;

  const completedCount = parsed.filter((p) => p.status === 'completed').length;
  const failedCount = parsed.filter((p) => p.status === 'failed').length;
  const hasProcessing = parsed.some((p) => p.status === 'processing');

  useEffect(() => {
    const lastProcessing = [...parsed].reverse().find((p) => p.status === 'processing');
    if (lastProcessing) {
      setExpandedItemId(lastProcessing.id);
    }
  }, [parsed]);

  useEffect(() => {
    if (wasProcessingRef.current && !hasProcessing) {
      setIsExpanded(false);
      setExpandedItemId(null);
    }
    wasProcessingRef.current = hasProcessing;
  }, [hasProcessing]);

  useEffect(() => {
    if (items.length > prevCountRef.current && timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
    prevCountRef.current = items.length;
  }, [items.length]);

  useEffect(() => {
    if (hasProcessing) {
      onRequestAutoScroll?.();
    }
  }, [hasProcessing, onRequestAutoScroll]);

  const toggleItem = useCallback((id: string) => {
    setExpandedItemId((prev) => (prev === id ? null : id));
  }, []);

  const needsScroll = totalCount > MAX_VISIBLE_ITEMS;
  const baseHeight = needsScroll
    ? MAX_VISIBLE_ITEMS * ITEM_HEIGHT
    : totalCount * ITEM_HEIGHT;
  const listHeight = expandedItemId ? EXPANDED_MAX_HEIGHT : baseHeight;
  const overflowY = (needsScroll || expandedItemId) ? 'auto' : 'hidden';

  const progressNode = (() => {
    if (failedCount > 0) {
      return (
        <span className="bash-group-progress error">
          <span className="codicon codicon-warning" style={{ fontSize: '12px', marginRight: '4px' }} />
          {failedCount} {t("tools.bashGroupFailed")}
        </span>
      );
    }
    if (totalCount > 0 && completedCount === totalCount) {
      return (
        <span className="bash-group-progress completed">
          <span className="codicon codicon-check" style={{ fontSize: '12px', marginRight: '4px' }} />
          {t("tools.bashGroupAllCompleted")}
        </span>
      );
    }
    return (
      <span className="bash-group-progress">
        {completedCount}/{totalCount}
      </span>
    );
  })();

  return (
    <ToolMarkerShell
      icon={<Terminal size={14} aria-hidden />}
      label={t("tools.bashGroupBatchRun")}
      ariaLabel={`${t("tools.bashGroupBatchRun")} (${totalCount})`}
      expanded={isExpanded}
      onToggle={() => setIsExpanded((prev) => !prev)}
      trailing={<span className="ml-auto shrink-0">{progressNode}</span>}
      contentClassName="min-w-0 flex-1"
      body={
        <div
          className="bash-group-timeline bash-panel mt-1 overflow-hidden rounded-md"
          ref={timelineRef}
          style={{
            maxHeight: `${listHeight + 16}px`,
            overflowY,
          }}
        >
          {parsed.map((entry, index) => {
            const isLast = index === parsed.length - 1;
            const isItemExpanded = expandedItemId === entry.id;
            const allOutputLines = entry.output ? entry.output.split(/\r?\n/) : [];
            const outputLines = allOutputLines.slice(-MAX_OUTPUT_LINES);
            const outputStartIndex = allOutputLines.length - outputLines.length;
            const highlightedOutputLines = outputLines.map((line) => highlightLine(line, 'bash'));

            return (
              <div key={entry.id} className="bash-timeline-item">
                <div className="bash-timeline-connector">
                  <div className={`bash-timeline-line${isLast ? ' last' : ''}`} />
                  <div className="bash-timeline-node" />
                </div>
                <div
                  className={`bash-timeline-content${isItemExpanded ? ' expanded' : ''}`}
                  onClick={() => toggleItem(entry.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleItem(entry.id);
                    }
                  }}
                >
                  <div className="bash-timeline-row">
                    <span className="bash-timeline-description">{entry.displayText}</span>
                    <div
                      className={`tool-status-indicator ${
                        entry.status === 'failed'
                          ? 'error'
                          : entry.status === 'completed'
                            ? 'completed'
                            : 'pending'
                      } bash-item-status`}
                    />
                  </div>
                  {isItemExpanded && (
                    <div className="bash-timeline-detail">
                      {entry.command ? (
                        <div className="bash-panel-section">
                          <div className="bash-panel-section-head">
                            <span className="bash-panel-section-title">
                              {t("tools.commandLabel")}
                            </span>
                          </div>
                          <div className="bash-command-block bash-panel-command">
                            {entry.command}
                          </div>
                        </div>
                      ) : null}
                      {outputLines.length > 0 ? (
                        <div className="bash-panel-section">
                          <div className="bash-panel-section-head">
                            <span className="bash-panel-section-title">
                              {t("tools.outputLabel")}
                            </span>
                            <button
                              type="button"
                              className="bash-command-copy-btn"
                              onClick={async (event) => {
                                event.stopPropagation();
                                if (await copyTextToClipboard(entry.output ?? "")) {
                                  setCopiedOutputId(entry.id);
                                  window.setTimeout(
                                    () =>
                                      setCopiedOutputId((prev) =>
                                        prev === entry.id ? null : prev,
                                      ),
                                    1200,
                                  );
                                } else {
                                  setCopiedOutputId(null);
                                }
                              }}
                            >
                              {copiedOutputId === entry.id
                                ? t("messages.copied")
                                : t("messages.copy")}
                            </button>
                          </div>
                          <div className="bash-output-block bash-panel-output normal">
                            {outputLines.map((line, i) => (
                              <div
                                key={`line-${outputStartIndex + i}`}
                                className="bash-output-line"
                              >
                                {ERROR_LINE_PATTERN.test(line) ? (
                                  <span className="bash-output-line-error">
                                    {line || " "}
                                  </span>
                                ) : line.length === 0 ? (
                                  <span>&nbsp;</span>
                                ) : (
                                  <span
                                    dangerouslySetInnerHTML={{
                                      __html: highlightedOutputLines[i] ?? "",
                                    }}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="bash-panel-empty">{t("tools.noOutput")}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      }
    >
      <span className="bash-marker-summary truncate text-muted-foreground">
        {t("tools.bashGroupCount", { count: totalCount })}
      </span>
    </ToolMarkerShell>
  );
});
