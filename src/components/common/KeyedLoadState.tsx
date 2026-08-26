import { useTranslation } from "react-i18next";

/**
 * KeyedLoadState —— 共享「加载失败 + 详情 + 重试」展示组件。
 *
 * 全局性问题模式止血：`数据 === null && 无 error → 永远「加载中」` 会把后端
 * 错误吞掉（2026-08-25 pi 闩中毒隐形 12.6h / 0.9.3 历史会话重载无效两起实证）。
 * 各 feature store 自管 errorByKey 状态（store 层不抽），本组件统一错误态的
 * 呈现与可访问性语义，禁止各面板手写内联结构。
 *
 * OpenSpec change：extract-keyed-load-state-component。
 */
export interface KeyedLoadStateProps {
 /** 后端错误详情（catch 的 message），原样展示。 */
 error: string;
 /** 重试回调——MUST 触发消费方的重新加载。 */
 onRetry: () => void;
 /** 失败标题；缺省用 `common.loadFailed`。 */
 title?: string;
 /** 重试按钮文案；缺省用 `common.retry`。 */
 retryLabel?: string;
 /** 容器 className（消费方保留既有 CSS 钩子）。 */
 className?: string;
 detailClassName?: string;
 retryClassName?: string;
}

export function KeyedLoadState({
 error,
 onRetry,
 title,
 retryLabel,
 className,
 detailClassName,
 retryClassName,
}: KeyedLoadStateProps) {
 const { t } = useTranslation();
 return (
  <div className={className ?? "keyed-load-state"} role="alert">
   <p>{title ?? t("common.loadFailed")}</p>
   <p className={detailClassName ?? "keyed-load-state-detail"}>{error}</p>
   <button
    type="button"
    className={retryClassName ?? "keyed-load-state-retry"}
    onClick={onRetry}
   >
    {retryLabel ?? t("common.retry")}
   </button>
  </div>
 );
}
