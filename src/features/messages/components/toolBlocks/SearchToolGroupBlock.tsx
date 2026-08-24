/**
 * 批量搜索分组组件
 * Groups multiple consecutive Search/Grep/Glob tool calls
 * 与「批量读取文件」共用 ExploreInlineToolGroup 壳层与 rail 列表样式
 */
import { memo, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { openUrl } from '@tauri-apps/plugin-opener';
import SearchIcon from 'lucide-react/dist/esm/icons/search';
import type { ConversationItem } from '../../../../types';
import {
  parseToolArgs,
  getFirstStringField,
  truncateText,
  extractToolName,
} from './toolConstants';
import { resolveSearchInlinePresentation } from './searchToolPresentation';
import { ExploreInlineItemRow, ExploreInlineToolGroup } from './ExploreInlineToolGroup';

type ToolItem = Extract<ConversationItem, { kind: 'tool' }>;

interface SearchToolGroupBlockProps {
  items: ToolItem[];
}

type SearchKindKey = 'match' | 'web' | 'search';

interface ParsedSearchItem {
  id: string;
  kindKey: SearchKindKey;
  pattern: string;
  summary: string;
}

const URL_GLOBAL_REGEX = /(https?:\/\/[^\s"'<>]+)/g;

function renderTextWithLinks(text: string): Array<{ type: 'text' | 'link'; value: string; href?: string }> {
  const parts: Array<{ type: 'text' | 'link'; value: string; href?: string }> = [];
  let lastIndex = 0;
  const matches = Array.from(text.matchAll(URL_GLOBAL_REGEX));

  for (const match of matches) {
    const url = match[1]?.replace(/[),.;!?]+$/, '');
    const index = match.index ?? -1;
    if (!url || index < 0) continue;
    if (index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, index) });
    }
    const matchedText = match[1] ?? url;
    parts.push({ type: 'link', value: matchedText, href: url });
    lastIndex = index + matchedText.length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', value: text }];
}

function resolveSearchKindKey(item: ToolItem): SearchKindKey {
  const name = extractToolName(item.title).toLowerCase();
  if (name.includes('glob') || name.includes('find')) return 'match';
  if (name.includes('web') || item.toolType === 'webSearch') return 'web';
  return 'search';
}

const SEARCH_KIND_I18N: Record<SearchKindKey, string> = {
  match: 'tools.kindMatch',
  web: 'tools.kindWeb',
  search: 'tools.kindSearch',
};

function parseSearchItem(
  item: ToolItem,
  t?: (key: string, options?: { count: number }) => string,
): ParsedSearchItem {
  const args = parseToolArgs(item.detail);
  const pattern = getFirstStringField(args, ['pattern', 'query', 'q', 'search_term', 'searchQuery', 'text']);
  const path = getFirstStringField(args, ['path', 'directory', 'dir']);
  const detail = item.detail?.trim() ?? '';
  const output = item.output?.trim() ?? '';
  const summaryRaw = output || detail || path;
  const presentation = resolveSearchInlinePresentation(summaryRaw, args, {
    maxLength: 90,
    pattern,
    t,
  });

  let patternDisplay = truncateText(pattern, 50);
  let summary = presentation.resultHint;

  // pattern 本身就是 URL 时，改放到 summary 以便渲染可点击链接，并去掉重复
  if (summary && (summary === pattern || summary === patternDisplay)) {
    patternDisplay = '';
  } else if (!summary && patternDisplay && /^https?:\/\//i.test(patternDisplay)) {
    summary = patternDisplay;
    patternDisplay = '';
  }

  return {
    id: item.id,
    kindKey: resolveSearchKindKey(item),
    pattern: patternDisplay,
    summary,
  };
}

function SearchDetailWithLinks({ text }: { text: string }) {
  return (
    <>
      {renderTextWithLinks(text).map((segment, idx) =>
        segment.type === 'link' && segment.href ? (
          <a
            key={`${segment.href}-${idx}`}
            className="search-inline-link"
            href={segment.href}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(event) => {
              event.preventDefault();
              void openUrl(segment.href!);
            }}
          >
            {segment.value}
          </a>
        ) : (
          <span key={`${segment.value}-${idx}`}>{segment.value}</span>
        ),
      )}
    </>
  );
}

export const SearchToolGroupBlock = memo(function SearchToolGroupBlock({
  items,
}: SearchToolGroupBlockProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const prevCountRef = useRef(items.length);

  const parsed = useMemo(
    () => items.map((item) => parseSearchItem(item, (key, options) => t(key, options))),
    [items, t],
  );

  useEffect(() => {
    if (items.length > prevCountRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    prevCountRef.current = items.length;
  }, [items.length]);

  if (parsed.length === 0) return null;

  const hasGlob = items.some((item) => {
    const name = extractToolName(item.title).toLowerCase();
    return name.includes('glob') || name.includes('find');
  });
  const groupLabel = hasGlob ? t('tools.batchSearchMatch') : t('tools.batchSearch');
  const title = `${groupLabel} (${items.length})`;

  return (
    <ExploreInlineToolGroup
      icon={<SearchIcon size={14} aria-hidden />}
      title={title}
      listRef={listRef}
    >
      {parsed.map((entry) => {
        const hasPattern = Boolean(entry.pattern);
        const titleAttr = [entry.pattern, entry.summary].filter(Boolean).join(' · ');
        // URL-only：pattern 已清空，summary 作 label 并保持可点击
        const label =
          !hasPattern && entry.summary
            ? <SearchDetailWithLinks text={entry.summary} />
            : (entry.pattern || entry.summary || '...');
        const detailText =
          hasPattern && entry.summary && entry.summary !== entry.pattern
            ? entry.summary
            : undefined;

        return (
          <ExploreInlineItemRow
            key={entry.id}
            kind={t(SEARCH_KIND_I18N[entry.kindKey])}
            label={label}
            detail={
              detailText ? <SearchDetailWithLinks text={detailText} /> : undefined
            }
            title={titleAttr || undefined}
          />
        );
      })}
    </ExploreInlineToolGroup>
  );
});
