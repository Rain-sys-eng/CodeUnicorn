import { startTransition, useEffect, useRef, useState } from "react";
import type {
  CliInstallAction,
  CliInstallEngine,
  CliInstallPlan,
  CliInstallProgressEvent,
  CliInstallResult,
  CliInstallStrategy,
  CodexDoctorResult,
} from "@/types";
import { getCliInstallPlan, runCliInstaller } from "@/services/tauri";
import { subscribeCliInstallerEvents } from "@/services/events";

export type CliInstallerStatus =
  | "idle"
  | "planning"
  | "ready"
  | "running"
  | "done"
  | "error";

export type CliInstallerLogLine = {
  id: string;
  phase: CliInstallProgressEvent["phase"];
  stream: CliInstallProgressEvent["stream"];
  message: string;
  receivedAtMs: number;
};

export type CliInstallerState = {
  status: CliInstallerStatus;
  engine: CliInstallEngine | null;
  action: CliInstallAction | null;
  plan: CliInstallPlan | null;
  result: CliInstallResult | null;
  error: string | null;
  progressRunId: string | null;
  logLines: CliInstallerLogLine[];
  startedAtMs: number | null;
  lastEventAtMs: number | null;
};

const MAX_INSTALLER_LOG_LINES = 120;

const IDLE_INSTALLER_STATE: CliInstallerState = {
  status: "idle",
  engine: null,
  action: null,
  plan: null,
  result: null,
  error: null,
  progressRunId: null,
  logLines: [],
  startedAtMs: null,
  lastEventAtMs: null,
};

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createInstallerRunId(engine: CliInstallEngine): string {
  return `${engine}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function resolveCliInstallStrategy(
  engine: CliInstallEngine,
  _action: CliInstallAction,
): CliInstallStrategy {
  if (engine === "claude") {
    return "officialNative";
  }
  return "npmGlobal";
}

export function resolveInstallerAction(
  doctorResult: CodexDoctorResult | null,
): CliInstallAction {
  return doctorResult?.ok ? "updateLatest" : "installLatest";
}

export function formatInstallerDurationMs(durationMs: number | null): string {
  if (durationMs === null) {
    return "-";
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${Math.round(durationMs / 100) / 10}s`;
}

function appendInstallerLog(
  lines: CliInstallerLogLine[],
  event: CliInstallProgressEvent,
): CliInstallerLogLine[] {
  if (!event.message && event.phase !== "finished") {
    return lines;
  }
  const message = event.message ?? `exitCode=${event.exitCode ?? "unknown"}`;
  const nextLine: CliInstallerLogLine = {
    id: `${event.runId}-${event.phase}-${Date.now()}-${lines.length}`,
    phase: event.phase,
    stream: event.stream,
    message,
    receivedAtMs: Date.now(),
  };
  return [...lines, nextLine].slice(-MAX_INSTALLER_LOG_LINES);
}

export type UseCliInstallLifecycleOptions = {
  onDoctorResult?: (
    engine: CliInstallEngine,
    result: CodexDoctorResult | null,
  ) => void;
  onFinished?: (result: CliInstallResult) => void;
};

export function useCliInstallLifecycle(
  options: UseCliInstallLifecycleOptions = {},
) {
  const { onDoctorResult, onFinished } = options;
  const [installerState, setInstallerState] =
    useState<CliInstallerState>(IDLE_INSTALLER_STATE);
  const [installerNowMs, setInstallerNowMs] = useState(() => Date.now());
  const installPlanRequestSeqRef = useRef(0);
  const onDoctorResultRef = useRef(onDoctorResult);
  const onFinishedRef = useRef(onFinished);
  onDoctorResultRef.current = onDoctorResult;
  onFinishedRef.current = onFinished;

  useEffect(() => {
    return subscribeCliInstallerEvents((event) => {
      setInstallerState((current) => {
        if (current.progressRunId !== event.runId) {
          return current;
        }
        return {
          ...current,
          logLines: appendInstallerLog(current.logLines, event),
          lastEventAtMs: Date.now(),
        };
      });
    });
  }, []);

  useEffect(() => {
    if (installerState.status !== "running") {
      return;
    }
    const interval = window.setInterval(() => {
      // 安装计时器秒针走 transition，避免安装期间每秒重渲染阻塞设置页交互。
      startTransition(() => {
        setInstallerNowMs(Date.now());
      });
    }, 1_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [installerState.status]);

  const requestInstallPlan = async (
    engine: CliInstallEngine,
    action: CliInstallAction,
  ) => {
    const requestSeq = installPlanRequestSeqRef.current + 1;
    installPlanRequestSeqRef.current = requestSeq;
    setInstallerState({
      ...IDLE_INSTALLER_STATE,
      status: "planning",
      engine,
      action,
    });
    try {
      const plan = await getCliInstallPlan(
        engine,
        action,
        resolveCliInstallStrategy(engine, action),
      );
      if (installPlanRequestSeqRef.current !== requestSeq) {
        return;
      }
      setInstallerState({
        ...IDLE_INSTALLER_STATE,
        status: "ready",
        engine,
        action,
        plan,
      });
    } catch (error) {
      if (installPlanRequestSeqRef.current !== requestSeq) {
        return;
      }
      setInstallerState({
        ...IDLE_INSTALLER_STATE,
        status: "error",
        engine,
        action,
        error: normalizeErrorMessage(error),
      });
    }
  };

  const confirmInstallRun = async () => {
    const { engine, action, plan } = installerState;
    if (!engine || !action || !plan || !plan.canRun) {
      return;
    }
    const runId = createInstallerRunId(engine);
    const startedAtMs = Date.now();
    setInstallerNowMs(startedAtMs);
    setInstallerState((current) => ({
      ...current,
      status: "running",
      error: null,
      result: null,
      progressRunId: runId,
      logLines: [],
      startedAtMs,
      lastEventAtMs: startedAtMs,
    }));
    try {
      const result = await runCliInstaller(
        engine,
        action,
        plan.strategy,
        runId,
      );
      onDoctorResultRef.current?.(engine, result.doctorResult);
      onFinishedRef.current?.(result);
      setInstallerState((current) => ({
        ...current,
        status: "done",
        result,
        error: null,
      }));
    } catch (error) {
      setInstallerState((current) => ({
        ...current,
        status: "error",
        error: normalizeErrorMessage(error),
      }));
    }
  };

  const cancelInstaller = () => {
    installPlanRequestSeqRef.current += 1;
    setInstallerState(IDLE_INSTALLER_STATE);
  };

  const isBusy =
    installerState.status === "planning" ||
    installerState.status === "running";

  return {
    installerState,
    installerNowMs,
    isBusy,
    requestInstallPlan,
    confirmInstallRun,
    cancelInstaller,
  };
}
