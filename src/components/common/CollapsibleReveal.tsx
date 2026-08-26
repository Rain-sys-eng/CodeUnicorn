/**
 * Shared animated expand/collapse body for render-surface modules.
 *
 * Uses CSS grid 0fr→1fr + opacity/translateY (session-activity radar +
 * process-phase drawer). Prefer this over display:none / conditional mount
 * so open and close both animate without per-module animation code.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type ReactNode,
  type TransitionEvent,
} from "react";
import { cn } from "@/lib/utils";

export type CollapsibleRevealProps = {
  open: boolean;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  style?: CSSProperties;
  /**
   * Keep children mounted while closed (e.g. reasoning markdown).
   * Default false: unmount after close animation for list perf.
   */
  keepMounted?: boolean;
  /** Forwarded to the outer panel for a11y / testing. */
  id?: string;
  "data-testid"?: string;
};

function readTransitionMs(node: HTMLElement): number {
  const styles = getComputedStyle(node);
  const durations = styles.transitionDuration.split(",").map((part) => part.trim());
  const delays = styles.transitionDelay.split(",").map((part) => part.trim());
  let maxMs = 0;
  for (let i = 0; i < durations.length; i += 1) {
    const durationPart = durations[i] ?? "0s";
    const delayPart = delays[i] ?? delays[delays.length - 1] ?? "0s";
    const durationMs = durationPart.endsWith("ms")
      ? Number.parseFloat(durationPart)
      : Number.parseFloat(durationPart) * 1000;
    const delayMs = delayPart.endsWith("ms")
      ? Number.parseFloat(delayPart)
      : Number.parseFloat(delayPart) * 1000;
    if (Number.isFinite(durationMs) && Number.isFinite(delayMs)) {
      maxMs = Math.max(maxMs, durationMs + delayMs);
    }
  }
  return maxMs;
}

/**
 * Animated collapsible panel.
 * - First paint open: no entrance flash (history hydrate).
 * - Remount open (was fully unmounted): one-shot enter animation.
 * - keepMounted toggle: CSS grid transition open/close.
 */
export function CollapsibleReveal({
  open,
  children,
  className,
  innerClassName,
  style,
  keepMounted = false,
  id,
  "data-testid": dataTestId,
}: CollapsibleRevealProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(() => open || keepMounted);
  const [isOpen, setIsOpen] = useState(() => open);
  const [playEnter, setPlayEnter] = useState(false);
  const closeFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasRenderedRef = useRef(open || keepMounted);

  const clearCloseFallback = () => {
    if (closeFallbackTimerRef.current != null) {
      clearTimeout(closeFallbackTimerRef.current);
      closeFallbackTimerRef.current = null;
    }
  };

  // 追踪已生效的 open 状态，避免 useLayoutEffect 内无条件 setState 形成
  // 「parent render → layout effect → child state → parent render」的同步闭环。
  // 与 Composer #185 修复同一模式：值未变时跳过 setState，切断自反馈链。
  const prevOpenRef = useRef(open);
  const prevKeepMountedRef = useRef(keepMounted);

  useLayoutEffect(() => {
    const prevOpen = prevOpenRef.current;
    const prevKeepMounted = prevKeepMountedRef.current;
    prevOpenRef.current = open;
    prevKeepMountedRef.current = keepMounted;

    clearCloseFallback();

    if (open) {
      const remounting = !wasRenderedRef.current;

      // Only set state when the value actually changes (#185 defense).
      if (!wasRenderedRef.current) {
        setShouldRender(true);
      }
      if (!prevOpen || prevKeepMounted !== keepMounted) {
        setIsOpen(true);
      }
      wasRenderedRef.current = true;

      // Only remounts need enter keyframes; keepMounted open uses CSS transition.
      const nextPlayEnter = remounting && !keepMounted;
      setPlayEnter((prev) => (prev === nextPlayEnter ? prev : nextPlayEnter));
      return clearCloseFallback;
    }

    if (prevOpen) {
      setIsOpen(false);
    }
    setPlayEnter((prev) => (prev ? false : prev));
    if (keepMounted) {
      wasRenderedRef.current = true;
      return clearCloseFallback;
    }

    const node = panelRef.current;
    if (!node || !wasRenderedRef.current) {
      if (wasRenderedRef.current) {
        setShouldRender(false);
      }
      wasRenderedRef.current = false;
      return clearCloseFallback;
    }

    const transitionMs = readTransitionMs(node);
    if (transitionMs <= 0) {
      setShouldRender(false);
      wasRenderedRef.current = false;
      return clearCloseFallback;
    }

    closeFallbackTimerRef.current = setTimeout(() => {
      setShouldRender(false);
      wasRenderedRef.current = false;
      closeFallbackTimerRef.current = null;
    }, transitionMs + 40);

    return clearCloseFallback;
  }, [open, keepMounted]);

  const finishCloseUnmount = () => {
    if (open || keepMounted) {
      return;
    }
    clearCloseFallback();
    setShouldRender(false);
    wasRenderedRef.current = false;
  };

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (
      event.propertyName !== "grid-template-rows" &&
      event.propertyName !== "opacity"
    ) {
      return;
    }
    finishCloseUnmount();
  };

  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    setPlayEnter(false);
  };

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      id={id}
      data-testid={dataTestId}
      data-state={isOpen ? "open" : "closed"}
      className={cn(
        "collapsible-reveal",
        isOpen && "is-open",
        playEnter && "collapsible-reveal-enter",
        className,
      )}
      style={style}
      aria-hidden={!isOpen}
      onTransitionEnd={handleTransitionEnd}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className={cn("collapsible-reveal-inner", innerClassName)}>{children}</div>
    </div>
  );
}
