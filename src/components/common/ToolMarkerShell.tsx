/**
 * 工具块共享外壳 - 统一 Marker 风格的折叠行
 * Shared shell for tool blocks rendered as shadcn Marker rows.
 * 定稿口径：对齐 thinking / explore meta 行 ——
 * --message-tool-row-font-size(13px) + 图标 14px + gap-2 + 行高 24 / 行盒 28px，
 * 无边框、muted —— 灰色 lucide 描边图标 + 内容 + 靠右状态图标 + 折叠体。
 *
 * 图标尺寸硬约束（勿再只靠调用方 size prop）：
 * Marker 默认 `[&_svg:not([class*='size-'])]:size-4`（16px）。若 icon 只有
 * Lucide `size={14}` 属性、没有 class 含 `size-`，该 CSS 仍会把 svg 盖成 16px，
 * 看起来比 explore Search / thinking Brain 的 14px 更大。壳层统一 normalize 为
 * size=14 + class size-3.5，并 `!size-3.5` 覆盖 Marker 默认。
 */
import {
  cloneElement,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import CircleAlert from 'lucide-react/dist/esm/icons/circle-alert';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { cn } from '@/lib/utils';
import { Marker, MarkerContent, MarkerIcon } from '../ui/marker';
import type { ToolStatusTone } from '../../utils/toolSemantics';
import { CollapsibleReveal } from './CollapsibleReveal';

/** 与 thinking Brain / explore Search 同为 14px */
export const TOOL_META_ICON_PX = 14;
const META_ICON_CLASS = 'size-3.5 shrink-0';

/** thinking / explore / 单工具 Marker 共用的活动行尺度（13/24，不抬全局 meta） */
export const TOOL_META_ROW_CLASS =
  'min-h-[var(--message-tool-row-min-height,28px)] gap-[var(--message-tool-row-icon-gap,8px)] rounded-md py-0.5 pr-1 text-[length:var(--message-tool-row-font-size,13px)] leading-[var(--message-tool-row-line-height,24px)] tracking-[0.01em] transition-colors';

/** 单块统一折叠体容器类：淡边框 + 2px 圆角 + muted/30 底、与头部小间距 */
export const TOOL_MARKER_BODY_CLASS =
  'mt-1 overflow-hidden rounded-[2px] border border-border bg-muted/30';

/**
 * 把传入的 lucide icon 归一到 meta 14px。
 * 必须带 class `size-3.5`：Marker 的 size-4 选择器会跳过含 size- 的 svg。
 */
function normalizeMetaIcon(icon: ReactNode): ReactNode {
  if (!isValidElement(icon)) {
    return icon;
  }
  const el = icon as ReactElement<{ className?: string; size?: number | string }>;
  return cloneElement(el, {
    size: TOOL_META_ICON_PX,
    className: cn(META_ICON_CLASS, el.props.className),
    'aria-hidden': true,
  } as Partial<typeof el.props> & { 'aria-hidden': true });
}

/**
 * 靠右状态图标：失败=警示、完成=不显示、处理中=转圈。
 * 自带 ml-auto，确保贴右。
 */
export function ToolStatusIcon({ status }: { status: ToolStatusTone }) {
  if (status === 'failed') {
    return <CircleAlert className={cn('ml-auto text-destructive', META_ICON_CLASS)} />;
  }
  if (status === 'completed') {
    return null;
  }
  return (
    <Loader2 className={cn('ml-auto animate-spin text-muted-foreground', META_ICON_CLASS)} />
  );
}

interface ToolMarkerShellProps {
  /**
   * 行首短动作类型（与 explore-inline 的 kind 同构：读取 / 修改 / 列表…）。
   * 渲染在 icon 之前，使用 explore-inline-kind 样式。
   */
  kind?: ReactNode;
  /** 前置 lucide 描边图标；壳层会强制归一到 14px（与 thinking/explore 一致） */
  icon: ReactNode;
  /** 类型标识：sr-only 时仅作无障碍/测试锚点；可见时作分组/工具标题 */
  label: ReactNode;
  /** label 是否视觉隐藏（单块动词隐藏、组块/MCP 标题可见） */
  labelHidden?: boolean;
  /** 给 Marker 的 aria-label（如 Search 需要 getByLabelText 锚点） */
  ariaLabel?: string;
  /** 给 Marker 的 ARIA role（如工具卡片需 role="group" 保留语义/测试锚点） */
  role?: string;
  expanded?: boolean;
  onToggle?: () => void;
  /** 是否可点击（默认 true）；false 时不绑定点击、不显示指针 */
  interactive?: boolean;
  /** Marker 容器附加类 */
  className?: string;
  /** 最外层 wrapper（含折叠体）附加类，用于承载块级间距等 */
  wrapperClassName?: string;
  /** MarkerContent 附加类 */
  contentClassName?: string;
  /** 靠右节点（状态图标 / 进度文本），自带 ml-auto */
  trailing?: ReactNode;
  /** Marker 主体内容（文件名 / 命令 / 计数 / 统计…） */
  children?: ReactNode;
  /** 展开体（自带容器与样式，可用 TOOL_MARKER_BODY_CLASS） */
  body?: ReactNode;
}

/**
 * 工具块折叠行外壳。头部恒为一行 Marker，展开体由调方自带容器，
 * 经 CollapsibleReveal 做统一开合动画（关合后卸载 DOM）。
 * clickable 时：可聚焦、Enter/Space 切换，并暴露 aria-expanded。
 */
export function ToolMarkerShell({
  kind,
  icon,
  label,
  labelHidden = false,
  ariaLabel,
  role,
  expanded = false,
  onToggle,
  interactive = true,
  className,
  wrapperClassName,
  contentClassName,
  trailing,
  children,
  body,
}: ToolMarkerShellProps) {
  const clickable = interactive && Boolean(onToggle);
  // 仅在未显式指定 role 时默认 button；显式 role="group" 不伪装成 button（避免全站 a11y 拧巴）。
  const resolvedRole = role ?? (clickable ? 'button' : undefined);
  const isButtonLike = clickable && resolvedRole === 'button';
  const hasKind = kind != null && kind !== '';

  return (
    <div className={wrapperClassName}>
      <Marker
        {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        {...(resolvedRole ? { role: resolvedRole } : {})}
        {...(clickable ? { onClick: onToggle } : {})}
        {...(isButtonLike
          ? {
              tabIndex: 0,
              'aria-expanded': body != null ? expanded : undefined,
              onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                  return;
                }
                event.preventDefault();
                onToggle?.();
              },
            }
          : {})}
        className={cn(
          // 覆盖 Marker 默认 text-sm/size-4，对齐 thinking / explore 的活动行尺度
          TOOL_META_ROW_CLASS,
          // ! 强制压过 Marker 的 size-4；选择器不依赖 :not(size-) 以免 merge/引号踩坑
          '[&_svg]:!size-3.5',
          clickable && 'cursor-pointer select-none',
          // 折叠 chevron 过渡；尊重 prefers-reduced-motion
          'motion-reduce:transition-none [&_svg]:transition-transform [&_svg]:duration-150 [&_svg]:ease-out motion-reduce:[&_svg]:transition-none',
          className,
        )}
      >
        {/* 与 SearchToolBlock / explore header 同序：action/file icon → kind → 内容
            （避免 kind 顶到行首、左侧缺 icon 列而与相邻搜索行割裂） */}
        <MarkerIcon className={cn(META_ICON_CLASS, '[&_svg]:!size-3.5')}>
          {normalizeMetaIcon(icon)}
        </MarkerIcon>
        {hasKind ? <span className="explore-inline-kind">{kind}</span> : null}
        {hasKind && (children != null || !labelHidden) ? (
          <span className="tool-meta-sep" aria-hidden />
        ) : null}
        <span className={labelHidden ? 'sr-only' : 'min-w-0 truncate font-normal'}>
          {label}
        </span>
        {children != null && (
          <MarkerContent
            className={cn('flex min-w-0 items-center gap-2 font-normal', contentClassName)}
          >
            {children}
          </MarkerContent>
        )}
        {trailing}
        {clickable && body != null && (
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none',
              // trailing 自带 ml-auto 已把右侧组顶到最右；无 trailing 时 chevron 自己贴右。
              // 避免双 ml-auto 平分空白导致状态图标被顶到中间。
              trailing == null && 'ml-auto',
              expanded && 'rotate-90',
            )}
          />
        )}
      </Marker>
      {body != null ? (
        <CollapsibleReveal open={expanded}>{body}</CollapsibleReveal>
      ) : null}
    </div>
  );
}
