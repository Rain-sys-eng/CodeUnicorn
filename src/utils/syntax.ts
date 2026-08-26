import Prism, { type Grammar } from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-c";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-css";
import "prismjs/components/prism-dart";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-go";
import "prismjs/components/prism-git";
import "prismjs/components/prism-groovy";
import "prismjs/components/prism-ini";
import "prismjs/components/prism-java";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-properties";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-yaml";
import { resolvePreviewLanguageFromPath } from "./fileLanguageRegistry";
import { escapeHtmlText as escapeHtml } from "./html";

/**
 * Defense-in-depth sanitizer for Prism.highlight output.
 * Prism only emits `<span class="token ...">` tags with HTML-escaped content,
 * but we strip anything unexpected as a safety net against potential Prism bugs.
 */
function sanitizePrismHtml(html: string): string {
  return html
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, "")
    .replace(/\bon\w+\s*=/gi, "data-removed=");
}

export function languageFromPath(path?: string | null) {
  return resolvePreviewLanguageFromPath(path);
}

// highlightLine is pure in (text, language), but it runs Prism per line and is
// called inside diff/preview render loops on every re-render. Without a cache a
// large diff re-tokenizes thousands of lines on each parent commit — the cause
// of multi-second style-recalc on WebKitGTK. LRU-cache the result (same Map idiom
// as fastMarkdownRenderer/cache.ts); a hit also returns the *same string*, so
// dangerouslySetInnerHTML consumers can skip re-writing the DOM.
const MAX_HIGHLIGHT_CACHE_ENTRIES = 4000;
const highlightCache = new Map<string, string>();

function readHighlightCache(cacheKey: string) {
  const cached = highlightCache.get(cacheKey);
  if (cached === undefined) {
    return undefined;
  }
  highlightCache.delete(cacheKey);
  highlightCache.set(cacheKey, cached);
  return cached;
}

function writeHighlightCache(cacheKey: string, html: string) {
  highlightCache.delete(cacheKey);
  highlightCache.set(cacheKey, html);
  while (highlightCache.size > MAX_HIGHLIGHT_CACHE_ENTRIES) {
    const oldestKey = highlightCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    highlightCache.delete(oldestKey);
  }
}

export function highlightLine(text: string, language?: string | null) {
  if (!language || !(Prism.languages as Record<string, unknown>)[language]) {
    return escapeHtml(text);
  }
  const cacheKey = `${language}\0${text}`;
  const cached = readHighlightCache(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const html = sanitizePrismHtml(
    Prism.highlight(text, Prism.languages[language] as Grammar, language),
  );
  writeHighlightCache(cacheKey, html);
  return html;
}
