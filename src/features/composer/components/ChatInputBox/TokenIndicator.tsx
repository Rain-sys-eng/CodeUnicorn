import { useTranslation } from 'react-i18next';

import {
  Context,
  ContextContent,
  ContextContentHeader,
  ContextTrigger,
  formatContextPercent,
} from '@/components/ai-elements/context';
import { Progress } from '@/components/ui/progress';
import { ClaudeContextCard } from './ClaudeContextCard';
import type { TokenIndicatorProps } from './types';

/**
 * TokenIndicator — 上下文占用指示器
 *
 * 视觉对齐 ai-elements 的 Context 组件：ghost 触发按钮（百分比 + SVG 圆环）
 * + HoverCard 概览卡（百分比、已用/总量、进度条）。
 * 入口常驻：还没有用量数据时显示空圆环，悬停提示等待回传。
 */
export const TokenIndicator = ({
  percentage,
  usedTokens,
  maxTokens,
  claudeContextUsage = null,
}: TokenIndicatorProps) => {
  const { t } = useTranslation();

  const resolvedPercentage =
    typeof percentage === 'number' && Number.isFinite(percentage)
      ? Math.max(percentage, 0)
      : null;

  const resolvedUsedTokens = claudeContextUsage?.usedTokens ?? usedTokens ?? null;
  const resolvedMaxTokens = claudeContextUsage?.contextWindow ?? maxTokens ?? null;
  const hasTokenCounts = resolvedUsedTokens !== null && resolvedMaxTokens !== null;
  const usedPercent = claudeContextUsage
    ? (claudeContextUsage.usedPercent ?? resolvedPercentage)
    : resolvedPercentage;

  return (
    <Context
      usedTokens={hasTokenCounts ? resolvedUsedTokens : (usedPercent ?? 0)}
      maxTokens={hasTokenCounts ? resolvedMaxTokens : 100}
      usedPercent={usedPercent}
    >
      {/* 尺寸对齐输入框下方的分支胶囊：28px 高、12px 字号、弱化前景色 */}
      <ContextTrigger
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5"
      />
      <ContextContent side="top" align="end">
        {claudeContextUsage ? (
          <ClaudeContextCard usage={claudeContextUsage} />
        ) : hasTokenCounts ? (
          <ContextContentHeader />
        ) : usedPercent !== null ? (
          <ContextContentHeader>
            <div className="flex items-center justify-between gap-3 text-xs">
              <p>{formatContextPercent(usedPercent)}</p>
            </div>
            <div className="space-y-2">
              <Progress
                className="bg-muted"
                value={Math.min(Math.max(usedPercent, 0), 100)}
              />
            </div>
          </ContextContentHeader>
        ) : (
          <ContextContentHeader>
            <div className="flex items-center justify-between gap-3 text-xs">
              <p className="text-muted-foreground">{t('chat.context')}</p>
              <p className="font-mono text-muted-foreground">
                {t('chat.claudeContextUnavailable')}
              </p>
            </div>
          </ContextContentHeader>
        )}
      </ContextContent>
    </Context>
  );
};
