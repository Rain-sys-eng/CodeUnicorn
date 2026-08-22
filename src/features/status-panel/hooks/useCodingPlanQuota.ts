import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCodingPlanQuota,
  type CodingPlanQuotaSnapshot,
} from "../../../services/tauri";

type UseCodingPlanQuotaOptions = {
  engine: string | null | undefined;
  providerProfileId?: string | null;
  enabled?: boolean;
};

/**
 * 按当前会话引擎 + provider profile 查询额度路由结果。
 *
 * 后端原则：
 * - 官方 Codex → source=codex/official_cli，前端接 account/rateLimits
 * - Codex/Claude 配了 MiniMax/Kimi 等 → source=coding_plan（供应商 API）
 * - Kimi 官方 → 优先 CLI oauth 凭据 + usages API（对齐 /status）
 * - Qoder Native → source=unsupported（无 RPC/HTTP 额度面，不刮 TUI /usage）
 * - 官方 Claude → source=none（无 plan 块）
 */
export function useCodingPlanQuota({
  engine,
  providerProfileId = null,
  enabled = true,
}: UseCodingPlanQuotaOptions) {
  const [snapshot, setSnapshot] = useState<CodingPlanQuotaSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || !engine) {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getCodingPlanQuota(engine, providerProfileId);
      if (requestId !== requestIdRef.current) {
        return;
      }
      setSnapshot(next);
      // official_cli / none 成功且无 error 不算失败
      if (
        !next.success &&
        next.error &&
        next.source !== "none" &&
        next.source !== "codex" &&
        next.source !== "official_cli"
      ) {
        setError(next.error);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setSnapshot({
        source: "error",
        success: false,
        error: message,
        windows: [],
        queriedAt: Date.now(),
      });
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, engine, providerProfileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}
