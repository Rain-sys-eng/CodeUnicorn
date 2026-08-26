import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import { useTranslation } from "react-i18next";
import { copyTextToClipboard } from "../../utils/clipboard";
import type { ToolCallParam } from "../presentation/toolCallBlocks";
import {
  ToolMarkerShell,
  TOOL_MARKER_BODY_CLASS,
} from "../../components/common/ToolMarkerShell";

type ToolCallBlockProps = {
  raw: string;
  tool?: string;
  params?: ReadonlyArray<ToolCallParam>;
  complete: boolean;
  isLive?: boolean;
};

const COPY_CONFIRMATION_MS = 1400;
const PREVIEW_MAX_LENGTH = 140;
const EMPTY_PARAMS: ReadonlyArray<ToolCallParam> = [];

export const ToolCallBlock = memo(function ToolCallBlock({
  raw,
  tool,
  params = EMPTY_PARAMS,
  complete,
  isLive = false,
}: ToolCallBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const live = isLive || !complete;
  const displayTool = tool?.trim() || t("messages.toolCallCard.unknownTool");
  const hasParams = params.length > 0;
  const preview = useMemo(() => {
    const source = params[0]?.value || raw;
    return compactPreview(source, PREVIEW_MAX_LENGTH);
  }, [params, raw]);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setCopied(false);
    }, COPY_CONFIRMATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const handleToggleExpanded = useCallback(() => {
    setExpanded((current) => !current);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!(await copyTextToClipboard(raw))) {
      return;
    }
    setCopied(true);
  }, [raw]);

  return (
    <ToolMarkerShell
      icon={<Wrench size={14} aria-hidden />}
      ariaLabel={t("messages.toolCallCard.title")}
      role="group"
      wrapperClassName="tcb-marker"
      label={
        <span className="tcb-title-line">
          <span>{t("messages.toolCallCard.title")}</span>
          <span className="tcb-title-separator" aria-hidden="true">·</span>
          <span className="tcb-tool-name">{displayTool}</span>
          {live ? (
            <>
              <span className="tcb-title-separator" aria-hidden="true">·</span>
              <span className="tcb-live-label">
                <span className="tcb-live-dot" aria-hidden="true" />
                {t("messages.toolCallCard.streaming")}
              </span>
            </>
          ) : null}
        </span>
      }
      trailing={
        <div className="tcb-actions">
          <button
            type="button"
            className="tcb-button"
            onClick={() => {
              void handleCopy();
            }}
            aria-label={copied ? t("messages.toolCallCard.copied") : t("messages.toolCallCard.copy")}
            title={copied ? t("messages.toolCallCard.copied") : t("messages.toolCallCard.copy")}
          >
            {copied ? t("messages.toolCallCard.copied") : t("messages.toolCallCard.copy")}
          </button>
          <button
            type="button"
            className="tcb-button"
            onClick={handleToggleExpanded}
            aria-expanded={expanded}
          >
            {expanded ? t("messages.toolCallCard.collapse") : t("messages.toolCallCard.expand")}
          </button>
        </div>
      }
      expanded={expanded}
      body={
        <div className={`tcb-body ${TOOL_MARKER_BODY_CLASS}`}>
          <div className="tcb-section">
            <div className="tcb-section-title">{t("messages.toolCallCard.parameters")}</div>
            {hasParams ? (
              <dl className="tcb-param-list">
                {params.map((param) => (
                  <div className="tcb-param-row" key={param.name}>
                    <dt>{param.name}</dt>
                    <dd>{param.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="tcb-empty">{t("messages.toolCallCard.noParams")}</div>
            )}
          </div>
          <div className="tcb-section">
            <div className="tcb-section-title">{t("messages.toolCallCard.rawPayload")}</div>
            <pre className="tcb-raw"><code>{raw}</code></pre>
          </div>
        </div>
      }
    >
      <span className="tcb-preview">{preview}</span>
    </ToolMarkerShell>
  );
});

function compactPreview(value: string, maxLength: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) {
    return compacted || "—";
  }
  return `${compacted.slice(0, maxLength - 1)}…`;
}
