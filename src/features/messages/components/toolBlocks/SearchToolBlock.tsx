/**
 * 搜索工具块组件 - 用于展示 Grep、Glob 等搜索操作
 * 与批量搜索共用 explore-inline 精简行：图标 + kind + 短 query + matches
 * 展开后在左侧 rail 下列出 query / path / summary
 */
import { memo, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { openUrl } from '@tauri-apps/plugin-opener';
import SearchIcon from 'lucide-react/dist/esm/icons/search';
import FolderSearch from 'lucide-react/dist/esm/icons/folder-search';
import type { ConversationItem } from '../../../../types';
import {
  parseToolArgs,
  getFirstStringField,
  extractToolName,
  resolveToolStatus,
  truncateText,
} from './toolConstants';
import { resolveSearchInlinePresentation } from './searchToolPresentation';
import { CollapsibleReveal } from '../../../../components/common/CollapsibleReveal';
import { cn } from '@/lib/utils';

interface SearchToolBlockProps {
  item: Extract<ConversationItem, { kind: 'tool' }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}

const URL_GLOBAL_REGEX = /(https?:\/\/[^\s"'<>]+)/g;
const PRIMARY_MAX_CHARS = 48;

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

function LinkedText({
  text,
  className,
  title,
}: {
  text: string;
  className?: string;
  title?: string;
}) {
  return (
    <span className={className} title={title}>
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
              event.stopPropagation();
              void openUrl(segment.href!);
            }}
          >
            {segment.value}
          </a>
        ) : (
          <span key={`${segment.value}-${idx}`}>{segment.value}</span>
        ),
      )}
    </span>
  );
}

function formatSearchDetailValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return trimmed;
  }
}

function resolveSearchKindLabel(
  item: Extract<ConversationItem, { kind: 'tool' }>,
  isGlob: boolean,
  t: (key: string) => string,
): string {
  if (isGlob) return t('tools.kindMatch');
  const name = extractToolName(item.title).toLowerCase();
  if (name.includes('web') || item.toolType === 'webSearch') return t('tools.kindWeb');
  return t('tools.kindSearch');
}

/**
 * 折叠行主文案：短 pattern / URL / 摘要，与 match 分离（对齐批量搜索行）
 */
function resolvePrimaryLabel(
  pattern: string,
  presentation: ReturnType<typeof resolveSearchInlinePresentation>,
): string {
  if (pattern.trim()) {
    return truncateText(pattern, PRIMARY_MAX_CHARS);
  }
  const header = presentation.headerSummary.trim();
  const hint = presentation.resultHint.trim();
  if (hint && header.endsWith(` · ${hint}`)) {
    return truncateText(header.slice(0, header.length - ` · ${hint}`.length), PRIMARY_MAX_CHARS);
  }
  if (hint && header === hint) {
    return truncateText(header, PRIMARY_MAX_CHARS);
  }
  return truncateText(header || hint, PRIMARY_MAX_CHARS);
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="explore-inline-item">
      <span className="explore-inline-kind">{label}</span>
      <span className="tool-meta-sep" aria-hidden />
      <span className="explore-inline-label" style={{ flex: '1 1 auto' }}>
        {children}
      </span>
    </div>
  );
}

export const SearchToolBlock = memo(function SearchToolBlock({
  item,
  isExpanded,
  onToggle,
}: SearchToolBlockProps) {
  const { t } = useTranslation();
  const toolName = extractToolName(item.title);
  const isGlob = toolName.toLowerCase().includes('glob') || toolName.toLowerCase().includes('find');

  const args = useMemo(() => parseToolArgs(item.detail), [item.detail]);

  const pattern = getFirstStringField(args, ['pattern', 'query', 'q', 'search_term', 'searchQuery', 'text']);
  const path = getFirstStringField(args, ['path', 'directory', 'dir']);
  const fallbackDetail = item.detail?.trim() ?? '';
  const inlineRaw = item.output || fallbackDetail || path || '';
  const presentation = useMemo(
    () =>
      resolveSearchInlinePresentation(inlineRaw, args, {
        maxLength: 120,
        pattern,
        t: (key, options) => t(key, options),
      }),
    [inlineRaw, args, pattern, t],
  );

  const kindLabel = resolveSearchKindLabel(item, isGlob, t);
  const primaryLabel = resolvePrimaryLabel(pattern, presentation);
  const matchHint =
    presentation.resultHint &&
    presentation.resultHint !== primaryLabel &&
    // 分组行里 resultHint 可能是 URL；折叠行若 primary 已是 URL 则不重复
    !(primaryLabel && presentation.resultHint.startsWith('http') && primaryLabel.startsWith('http'))
      ? presentation.resultHint
      : '';

  const displayName = isGlob ? t('tools.fileMatch') : t('tools.search');
  const expandedOutput = useMemo(
    () => formatSearchDetailValue(item.output ?? ''),
    [item.output],
  );
  const expandedDetail = useMemo(
    () => formatSearchDetailValue(item.detail ?? ''),
    [item.detail],
  );
  const shouldShowExpandedOutput = expandedOutput.length > 0;
  const shouldShowExpandedDetail = !shouldShowExpandedOutput && expandedDetail.length > 0;
  const hasExpandedDetails =
    Boolean(pattern) || Boolean(path) || shouldShowExpandedOutput || shouldShowExpandedDetail;

  const status = resolveToolStatus(item.status, Boolean(item.output));
  const headerTitle = presentation.headerTitle || primaryLabel;

  return (
    <div
      className={cn(
        'tool-inline explore-inline is-collapsible',
        !(isExpanded && hasExpandedDetails) && 'is-collapsed',
      )}
    >
      <div className="tool-inline-content">
        <div className="explore-inline-header">
          <button
            type="button"
            className="explore-inline-header-toggle"
            onClick={() => {
              if (hasExpandedDetails) onToggle(item.id);
            }}
            aria-expanded={hasExpandedDetails ? isExpanded : undefined}
            aria-label={displayName}
            disabled={!hasExpandedDetails}
            style={!hasExpandedDetails ? { cursor: 'default' } : undefined}
          >
            {isGlob ? (
              <FolderSearch className="explore-inline-icon" size={14} aria-hidden />
            ) : (
              <SearchIcon className="explore-inline-icon" size={14} aria-hidden />
            )}
            {/* 与批量搜索行同构：kind + 短 query + matches */}
            <span className="explore-inline-title search-tool-inline-title" title={headerTitle}>
              <span className="explore-inline-kind">{kindLabel}</span>
              {primaryLabel ? <span className="tool-meta-sep" aria-hidden /> : null}
              {primaryLabel ? (
                <LinkedText text={primaryLabel} className="explore-inline-label" title={headerTitle} />
              ) : null}
              {matchHint ? (
                /^https?:\/\//i.test(matchHint) ? (
                  <LinkedText text={matchHint} className="explore-inline-detail" />
                ) : (
                  <span className="explore-inline-detail">{matchHint}</span>
                )
              ) : null}
              {status === 'failed' ? (
                <span className="explore-inline-detail" style={{ color: 'var(--destructive, #dc2626)' }}>
                  {t('tools.failed')}
                </span>
              ) : null}
              {status === 'processing' ? (
                <span className="explore-inline-detail">…</span>
              ) : null}
            </span>
          </button>
        </div>
        <CollapsibleReveal open={isExpanded && hasExpandedDetails}>
          <div className="explore-inline-list">
            {pattern ? (
              <DetailField label={t('tools.queryLabel')}>
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{pattern}</span>
              </DetailField>
            ) : null}
            {path ? (
              <DetailField label={t('tools.path')}>
                <span style={{ wordBreak: 'break-all' }}>{path}</span>
              </DetailField>
            ) : null}
            {shouldShowExpandedOutput ? (
              <DetailField label={t('tools.summaryLabel')}>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    font: 'inherit',
                  }}
                >
                  {expandedOutput}
                </pre>
              </DetailField>
            ) : null}
            {shouldShowExpandedDetail ? (
              <DetailField label={t('tools.detailLabel')}>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    font: 'inherit',
                  }}
                >
                  {expandedDetail}
                </pre>
              </DetailField>
            ) : null}
          </div>
        </CollapsibleReveal>
      </div>
    </div>
  );
});
