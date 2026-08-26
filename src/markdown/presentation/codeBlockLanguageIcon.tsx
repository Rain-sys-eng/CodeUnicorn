import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { copyTextToClipboard } from "../../utils/clipboard";
import Braces from "lucide-react/dist/esm/icons/braces";
import Check from "lucide-react/dist/esm/icons/check";
import Code from "lucide-react/dist/esm/icons/code";
import Copy from "lucide-react/dist/esm/icons/copy";
import FileCode from "lucide-react/dist/esm/icons/file-code";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Hash from "lucide-react/dist/esm/icons/hash";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import Sigma from "lucide-react/dist/esm/icons/sigma";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import type { LucideIcon } from "lucide-react";

/**
 * Map a fenced-code-block language tag to a lucide icon for the
 * code block header. lucide has no per-language brand logos, so we
 * group languages into semantic icon buckets (data/shell/markup/...).
 *
 * ponytail: bucket map, not exhaustive per-language. Unknown tags fall
 * back to a generic code icon. Add a bucket entry when a new language
 * deserves a distinct glyph.
 */
const LANGUAGE_ICON_BUCKETS: Record<string, LucideIcon> = {
  // Data / config (curly-brace shaped)
  json: Braces,
  json5: Braces,
  jsonc: Braces,
  // Config / properties
  yaml: Settings2,
  yml: Settings2,
  toml: Settings2,
  ini: Settings2,
  properties: Settings2,
  env: Settings2,
  dotenv: Settings2,
  // Shell / terminal
  bash: Terminal,
  sh: Terminal,
  shell: Terminal,
  zsh: Terminal,
  console: Terminal,
  powershell: Terminal,
  ps1: Terminal,
  dockerfile: Terminal,
  // Markup / docs
  markdown: FileText,
  md: FileText,
  mdx: FileText,
  text: FileText,
  plaintext: FileText,
  diff: FileText,
  // Math
  latex: Sigma,
  tex: Sigma,
  math: Sigma,
  // CSS-ish
  css: Hash,
  scss: Hash,
  sass: Hash,
  less: Hash,
};

/**
 * Resolve a lucide icon component for a language tag. Returns a generic
 * code icon for unknown / missing tags so the header icon slot is never
 * empty.
 */
export function getCodeBlockLanguageIcon(languageTag: string | null): LucideIcon {
  if (!languageTag) {
    return Code;
  }
  return LANGUAGE_ICON_BUCKETS[languageTag.trim().toLowerCase()] ?? FileCode;
}

/**
 * Code block header language badge: a language icon followed by the
 * language / filename label. Shared by every code block variant so the
 * header stays consistent across CodeBlock, Mermaid, LaTeX, etc.
 */
export function CodeBlockLanguageBadge({
  languageTag,
  label,
  title,
}: {
  languageTag: string | null;
  label: string;
  title?: string;
}) {
  const Icon = getCodeBlockLanguageIcon(languageTag);
  return (
    <span className="markdown-codeblock-language" title={title}>
      <Icon className="markdown-codeblock-language-icon" aria-hidden="true" />
      <span className="markdown-codeblock-language-text">{label}</span>
    </span>
  );
}

/**
 * Code block copy button: a single icon-only button matching the shadcn
 * docs style (Copy icon, Check on success). Alt+Click copies the fenced
 * variant when `copyUseModifier` is enabled, preserving the old
 * fence-copy capability without a second button.
 */
export function CodeBlockCopyButton({
  value,
  fencedValue,
  copyUseModifier,
}: {
  value: string;
  fencedValue: string;
  copyUseModifier: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    const nextValue = copyUseModifier && event.altKey ? fencedValue : value;
    if (!(await copyTextToClipboard(nextValue))) {
      return;
    }
    setCopied(true);
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
    }, 1200);
  };

  return (
    <button
      type="button"
      className={`ghost markdown-codeblock-copy${copied ? " is-copied" : ""}`}
      onClick={handleCopy}
      aria-label={t("messages.copyCodeBlock")}
      title={copied ? t("messages.copied") : t("messages.copy")}
    >
      {copied ? (
        <Check className="markdown-codeblock-copy-icon" aria-hidden="true" />
      ) : (
        <Copy className="markdown-codeblock-copy-icon" aria-hidden="true" />
      )}
    </button>
  );
}
