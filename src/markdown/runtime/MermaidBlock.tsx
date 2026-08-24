import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import Code from "lucide-react/dist/esm/icons/code";
import Copy from "lucide-react/dist/esm/icons/copy";
import FileCode from "lucide-react/dist/esm/icons/file-code";
import Eye from "lucide-react/dist/esm/icons/eye";
import Maximize2 from "lucide-react/dist/esm/icons/maximize-2";
import {
  isThemeMutationAttribute,
  mapAppearanceToMermaidTheme,
  readDocumentThemeAppearance,
} from "../../features/theme/utils/themeAppearance";
import {
  MermaidFullscreenViewer,
  preloadViewerjs,
} from "../../features/markdown/mermaidFullscreen";
import { copyTextToClipboard } from "../../utils/clipboard";
import { CodeBlockLanguageBadge } from "../presentation/codeBlockLanguageIcon";
import { normalizeMermaidSource } from "../presentation/normalizeMermaidSource";

type MermaidBlockProps = {
  value: string;
  copyUseModifier: boolean;
};

type RenderState =
  | { status: "idle" }
  | { status: "rendering" }
  | { status: "success"; svg: string }
  | { status: "error"; message: string };

function detectMermaidTheme(): "dark" | "default" {
  return mapAppearanceToMermaidTheme(readDocumentThemeAppearance());
}

export default function MermaidBlock({
  value,
  copyUseModifier,
}: MermaidBlockProps) {
  const { t } = useTranslation();
  const [renderState, setRenderState] = useState<RenderState>({
    status: "idle",
  });
  const [showSource, setShowSource] = useState(false);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [copiedMode, setCopiedMode] = useState<"plain" | "fenced" | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const copyTimeoutRef = useRef<number | null>(null);
  const idRef = useRef(`mermaid-${crypto.randomUUID()}`);

  // debounce value for streaming output – use a longer delay to avoid
  // repeatedly re-rendering expensive Mermaid diagrams while chunks arrive.
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), 800);
    return () => window.clearTimeout(timer);
  }, [value]);

  // render mermaid diagram
  useEffect(() => {
    let cancelled = false;
    setRenderState({ status: "rendering" });

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const theme = detectMermaidTheme();
        mermaid.initialize({
          startOnLoad: false,
          theme,
          securityLevel: "strict",
          fontFamily:
            "ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif",
        });

        // mermaid.render requires a unique id each call
        const id = `${idRef.current}-${Date.now()}`;
        // Quote unsafe flowchart labels (parens / <br/>) so LLM diagrams parse.
        // Source toggle / copy still use the original `value`.
        const renderSource = normalizeMermaidSource(debouncedValue);
        const { svg } = await mermaid.render(id, renderSource);
        if (!cancelled) {
          setRenderState({ status: "success", svg });
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : String(error);
          setRenderState({ status: "error", message });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedValue, renderKey]);

  // re-render on theme change
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (isThemeMutationAttribute(mutation.attributeName)) {
          setRenderKey((prev) => prev + 1);
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Warm the viewerjs import as soon as we have a successful render
  // so the first Fullscreen click does not pay the dynamic-import cost.
  useEffect(() => {
    if (renderState.status === "success" && renderState.svg) {
      void preloadViewerjs();
    }
  }, [renderState]);

  const fencedValue = `\`\`\`mermaid\n${value}\n\`\`\``;

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    const nextValue = copyUseModifier && event.altKey ? fencedValue : value;
    if (!(await copyTextToClipboard(nextValue))) {
      return;
    }
    setCopiedMode(nextValue === fencedValue ? "fenced" : "plain");
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => {
      setCopiedMode(null);
    }, 1200);
  };

  const handleCopyFenced = async () => {
    if (!(await copyTextToClipboard(fencedValue))) {
      return;
    }
    setCopiedMode("fenced");
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => {
      setCopiedMode(null);
    }, 1200);
  };

  const handleToggleSource = () => {
    setShowSource((prev) => !prev);
  };

  return (
    <div className="markdown-codeblock markdown-mermaidblock">
      <div className="markdown-codeblock-header">
        <CodeBlockLanguageBadge languageTag="mermaid" label="Mermaid" />
        <div className="markdown-mermaidblock-actions">
          <button
            type="button"
            className="ghost markdown-codeblock-copy markdown-mermaidblock-action"
            onClick={handleToggleSource}
            aria-label={
              showSource
                ? t("messages.previewMermaidDiagram")
                : t("messages.showMermaidSource")
            }
            title={
              showSource
                ? t("messages.previewMermaidDiagram")
                : t("messages.showMermaidSource")
            }
          >
            {showSource ? (
              <Eye className="markdown-codeblock-copy-icon" aria-hidden="true" />
            ) : (
              <Code className="markdown-codeblock-copy-icon" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className={`ghost markdown-codeblock-copy markdown-mermaidblock-action${copiedMode === "plain" ? " is-copied" : ""}`}
            onClick={handleCopy}
            aria-label={t("messages.copyCodeBlock")}
            title={copiedMode === "plain" ? t("messages.copied") : t("messages.copy")}
          >
            {copiedMode === "plain" ? (
              <Check className="markdown-codeblock-copy-icon" aria-hidden="true" />
            ) : (
              <Copy className="markdown-codeblock-copy-icon" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className={`ghost markdown-codeblock-copy markdown-mermaidblock-action${copiedMode === "fenced" ? " is-copied" : ""}`}
            onClick={handleCopyFenced}
            aria-label={t("messages.copyCodeBlockWithFence")}
            title={copiedMode === "fenced" ? t("messages.copied") : t("messages.copyWithFence")}
          >
            {copiedMode === "fenced" ? (
              <Check className="markdown-codeblock-copy-icon" aria-hidden="true" />
            ) : (
              <FileCode className="markdown-codeblock-copy-icon" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="ghost markdown-codeblock-copy markdown-mermaidblock-action"
            onClick={() => setIsFullscreenOpen(true)}
            disabled={renderState.status !== "success"}
            aria-label={t("common.markdownMermaidFullscreenHint")}
            title={t("common.markdownMermaidFullscreen")}
            data-testid="mermaid-fullscreen-button"
          >
            <Maximize2 className="markdown-codeblock-copy-icon" aria-hidden="true" />
          </button>
        </div>
      </div>

      {showSource ? (
        <pre>
          <code className="language-mermaid">{value}</code>
        </pre>
      ) : renderState.status === "success" ? (
        <div
          className="markdown-mermaidblock-diagram"
          dangerouslySetInnerHTML={{ __html: renderState.svg }}
        />
      ) : renderState.status === "error" ? (
        <div className="markdown-mermaidblock-error">
          <div className="markdown-mermaidblock-error-hint">
            Render failed: {renderState.message}
          </div>
          <pre>
            <code className="language-mermaid">{value}</code>
          </pre>
        </div>
      ) : (
        <div className="markdown-mermaidblock-loading">
          Rendering diagram...
        </div>
      )}

      <MermaidFullscreenViewer
        open={isFullscreenOpen}
        svg={renderState.status === "success" ? renderState.svg : ""}
        onClose={() => setIsFullscreenOpen(false)}
      />
    </div>
  );
}
