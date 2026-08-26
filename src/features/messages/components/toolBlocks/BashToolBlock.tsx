/**
 * 终端命令工具块
 * Marker 折叠行：终端图标 + 「终端命令」；展开体为「命令 / 输出」分区。
 */
import { memo, useMemo, useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import type { ConversationItem } from "../../../../types";
import { copyTextToClipboard } from "../../../../utils/clipboard";
import { highlightLine } from "../../../../utils/syntax";
import {
  buildCommandSummary,
  truncateText,
  resolveToolStatus,
} from "./toolConstants";
import { ToolMarkerShell, ToolStatusIcon } from "./ToolMarkerShell";

interface BashToolBlockProps {
  item: Extract<ConversationItem, { kind: "tool" }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onRequestAutoScroll?: () => void;
}

const MAX_OUTPUT_LINES = 200;
const HEADER_OUTPUT_PREVIEW_MAX = 48;

/**
 * 清理命令文本，移除 shell 包装
 */
function cleanCommand(commandText: string): string {
  if (!commandText) return "";
  const trimmed = commandText.trim();

  const shellMatch = trimmed.match(
    /^(?:\/\S+\/)?(?:bash|zsh|sh|fish)(?:\.exe)?\s+-(?:l?c)\s+(['"])([\s\S]+)\1$/,
  );
  const inner = shellMatch ? (shellMatch[2] ?? trimmed) : trimmed;

  const cdMatch = inner.match(/^\s*cd\s+[^&;]+(?:\s*&&\s*|\s*;\s*)([\s\S]+)$/i);
  const stripped = cdMatch ? (cdMatch[1] ?? inner) : inner;

  return stripped.trim();
}

function getStatus(
  item: Extract<ConversationItem, { kind: "tool" }>,
): "completed" | "processing" | "failed" {
  return resolveToolStatus(item.status, Boolean(item.output));
}

function countNonEmptyLines(lines: readonly string[]): number {
  return lines.reduce((count, line) => (line.trim() ? count + 1 : count), 0);
}

function firstNonEmptyLine(lines: readonly string[]): string {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

export const BashToolBlock = memo(function BashToolBlock({
  item,
  isExpanded,
  onToggle,
  onRequestAutoScroll,
}: BashToolBlockProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPinned, setIsPinned] = useState(true);
  const [showLiveOutput, setShowLiveOutput] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);

  const summaryCommand = useMemo(
    () => buildCommandSummary(item, { includeDetail: false }),
    [item],
  );
  const command = cleanCommand(summaryCommand);

  const status = getStatus(item);
  const isRunning = status === "processing";
  const durationMs = typeof item.durationMs === "number" ? item.durationMs : null;
  const isLongRunning = durationMs !== null && durationMs >= 1200;

  const { outputLines, outputStartIndex, totalOutputLines } = useMemo(() => {
    if (!item.output) {
      return { outputLines: [] as string[], outputStartIndex: 0, totalOutputLines: 0 };
    }
    const lines = item.output.split(/\r?\n/);
    if (lines.length <= MAX_OUTPUT_LINES) {
      return {
        outputLines: lines,
        outputStartIndex: 0,
        totalOutputLines: lines.length,
      };
    }
    return {
      outputLines: lines.slice(-MAX_OUTPUT_LINES),
      outputStartIndex: lines.length - MAX_OUTPUT_LINES,
      totalOutputLines: lines.length,
    };
  }, [item.output]);
  const highlightedOutputLines = useMemo(
    () => outputLines.map((line) => highlightLine(line, "bash")),
    [outputLines],
  );
  const nonEmptyOutputLines = useMemo(
    () => countNonEmptyLines(outputLines),
    [outputLines],
  );
  const outputPreview = useMemo(
    () => truncateText(firstNonEmptyLine(outputLines), HEADER_OUTPUT_PREVIEW_MAX),
    [outputLines],
  );

  useEffect(() => {
    if (!isRunning) {
      setShowLiveOutput(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setShowLiveOutput(true);
    }, 600);
    return () => window.clearTimeout(timeoutId);
  }, [isRunning]);

  const handleScroll = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    const threshold = 6;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    setIsPinned(distanceFromBottom <= threshold);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !isPinned) return;
    node.scrollTop = node.scrollHeight;
  }, [outputLines, isPinned]);

  useEffect(() => {
    if (isRunning && showLiveOutput) {
      onRequestAutoScroll?.();
    }
  }, [isRunning, showLiveOutput, onRequestAutoScroll]);

  const isError = status === "failed";
  const showBody = isExpanded || (isRunning && showLiveOutput) || isLongRunning || isError;
  const isErrorLine = (line: string) =>
    /(?:\berror\b|\bfailed\b|\bexception\b)/i.test(line);
  const isTableLikeLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);

  // Hover / a11y only — header copy stays short ("终端命令").
  const headerTooltip = command || outputPreview || t("tools.terminalCommand");

  const copyText = useCallback(async (value: string, kind: "command" | "output") => {
    if (await copyTextToClipboard(value)) {
      if (kind === "command") {
        setCopiedCommand(true);
        window.setTimeout(() => setCopiedCommand(false), 1200);
      } else {
        setCopiedOutput(true);
        window.setTimeout(() => setCopiedOutput(false), 1200);
      }
    } else {
      if (kind === "command") {
        setCopiedCommand(false);
      } else {
        setCopiedOutput(false);
      }
    }
  }, []);

  return (
    <ToolMarkerShell
      icon={<Terminal size={14} aria-hidden />}
      label={t("tools.terminalCommand")}
      ariaLabel={
        command
          ? `${t("tools.terminalCommand")}: ${command}`
          : t("tools.terminalCommand")
      }
      className="bash-tool-marker"
      expanded={showBody}
      onToggle={() => onToggle(item.id)}
      trailing={<ToolStatusIcon status={status} />}
      body={
        <div className="bash-panel" title={headerTooltip}>
          {isExpanded && command ? (
            <div className="bash-panel-section">
              <div className="bash-panel-section-head">
                <span className="bash-panel-section-title">{t("tools.commandLabel")}</span>
                <button
                  type="button"
                  className="bash-command-copy-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    void copyText(command, "command");
                  }}
                >
                  {copiedCommand ? t("messages.copied") : t("messages.copy")}
                </button>
              </div>
              <div className="bash-command-block bash-panel-command">{command}</div>
            </div>
          ) : null}

          {outputLines.length > 0 ? (
            <div className="bash-panel-section">
              <div className="bash-panel-section-head">
                <span className="bash-panel-section-title">
                  {t("tools.outputLabel")}
                  {totalOutputLines > 0 ? (
                    <span className="bash-panel-section-meta">
                      {t("tools.outputLineCount", {
                        count: Math.max(nonEmptyOutputLines, totalOutputLines),
                      })}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="bash-command-copy-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    void copyText(item.output ?? "", "output");
                  }}
                >
                  {copiedOutput ? t("messages.copied") : t("messages.copy")}
                </button>
              </div>
              <div
                className={`bash-output-block bash-panel-output ${isError ? "error" : "normal"}`}
                ref={containerRef}
                onScroll={handleScroll}
                role="log"
                aria-live="polite"
              >
                {outputLines.map((line, index) => (
                  <div
                    key={`line-${outputStartIndex + index}`}
                    className="bash-output-line"
                  >
                    {isErrorLine(line) ? (
                      <span className="bash-output-line-error">{line || " "}</span>
                    ) : line.length === 0 ? (
                      <span>&nbsp;</span>
                    ) : isTableLikeLine(line) ? (
                      <span>{line}</span>
                    ) : (
                      <span
                        dangerouslySetInnerHTML={{
                          __html: highlightedOutputLines[index] ?? "",
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : isExpanded ? (
            <div className="bash-panel-section">
              <div className="bash-panel-empty">{t("tools.noOutput")}</div>
            </div>
          ) : null}
        </div>
      }
    />
  );
});
