export function formatSharedProviderRetryDate(atMs: number): string {
  const date = new Date(atMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function formatSharedProviderRetryElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function resolveSharedProviderRetryElapsed(input: {
  seriesStartedAtMs?: number | null;
  batchStartedAtMs?: number | null;
  now?: number;
}): { total: string; batch: string } {
  const now = input.now ?? Date.now();
  const seriesStartedAtMs = input.seriesStartedAtMs ?? now;
  const batchStartedAtMs = input.batchStartedAtMs ?? seriesStartedAtMs;
  return {
    total: formatSharedProviderRetryElapsed(now - seriesStartedAtMs),
    batch: formatSharedProviderRetryElapsed(now - batchStartedAtMs),
  };
}
