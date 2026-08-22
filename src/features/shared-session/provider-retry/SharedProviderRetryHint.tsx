import { useTranslation } from "react-i18next";
import Play from "lucide-react/dist/esm/icons/play";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Square from "lucide-react/dist/esm/icons/square";

import { resolveEngineLabel } from "../../../utils/turnBadge";
import {
  cancelSharedProviderRetry,
  fireSharedProviderRetry,
  startSharedProviderRetryManually,
} from "./noteSharedProviderRetryTurn";
import { useSharedProviderRetryOverlay } from "./providerRetryControllerStore";
import type { SharedProviderRetryKind } from "./classifySharedProviderRetryError";

type SharedProviderRetryHintProps = {
  workspaceId: string | null | undefined;
  threadId: string | null | undefined;
};

function reasonKey(kind: SharedProviderRetryKind | null): string {
  switch (kind) {
    case "pool":
      return "providerRetryReasonPool";
    case "rate":
      return "providerRetryReasonRate";
    case "timeout":
      return "providerRetryReasonTimeout";
    case "overload":
      return "providerRetryReasonOverload";
    case "server":
      return "providerRetryReasonServer";
    case "soft-cancel":
      return "providerRetryReasonSoftCancel";
    case "config":
      return "providerRetryReasonConfig";
    case "overflow":
      return "providerRetryReasonOverflow";
    case "permission":
      return "providerRetryReasonPermission";
    case "user-stop":
      return "providerRetryReasonStopped";
    default:
      return "providerRetryReasonUnknown";
  }
}

export function SharedProviderRetryHint({
  workspaceId,
  threadId,
}: SharedProviderRetryHintProps) {
  const { t } = useTranslation();
  const overlay = useSharedProviderRetryOverlay(workspaceId, threadId);
  if (!workspaceId || !threadId || !overlay || overlay.phase === "idle") {
    return null;
  }

  const cli = resolveEngineLabel(overlay.engine);
  const reason = t(`sharedSend.${reasonKey(overlay.kind)}`);
  let copy = "";
  if (overlay.phase === "wait") {
    copy = t("sharedSend.providerRetryWait", {
      cli,
      reason,
      seconds: overlay.seconds,
      n: overlay.attempt,
      max: overlay.maxAttempts,
    });
  } else if (overlay.phase === "sending") {
    copy = t("sharedSend.providerRetrySending", {
      cli,
      n: overlay.attempt,
      max: overlay.maxAttempts,
    });
  } else if (overlay.phase === "exhausted") {
    copy = t("sharedSend.providerRetryExhausted", {
      cli,
      max: overlay.maxAttempts,
    });
  } else if (overlay.phase === "permanent") {
    copy = t("sharedSend.providerRetryPermanent", { reason });
  } else if (overlay.phase === "stopped") {
    copy = t("sharedSend.providerRetryStopped");
  } else if (overlay.phase === "success") {
    copy = t("sharedSend.providerRetrySuccess", { n: overlay.attempt });
  }

  const showNow = overlay.phase === "wait";
  const showStop = overlay.phase === "wait" || overlay.phase === "sending";
  const showManual =
    overlay.phase === "exhausted" ||
    overlay.phase === "permanent" ||
    overlay.phase === "stopped";

  return (
    <div
      className={`shared-provider-retry-hint is-${overlay.phase}`}
      data-testid="shared-provider-retry-hint"
      role="status"
    >
      <span className="shared-provider-retry-hint__copy">{copy}</span>
      <span className="shared-provider-retry-hint__acts">
        {showNow ? (
          <button
            type="button"
            className="shared-provider-retry-hint__btn"
            onClick={() => fireSharedProviderRetry(workspaceId, threadId)}
          >
            <Play size={10} strokeWidth={2.6} aria-hidden />
            {t("sharedSend.providerRetryNow")}
          </button>
        ) : null}
        {showStop ? (
          <button
            type="button"
            className="shared-provider-retry-hint__btn"
            onClick={() => cancelSharedProviderRetry(workspaceId, threadId)}
          >
            <Square size={8} strokeWidth={2.6} aria-hidden />
            {t("sharedSend.providerRetryStop")}
          </button>
        ) : null}
        {showManual ? (
          <button
            type="button"
            className="shared-provider-retry-hint__btn"
            onClick={() =>
              startSharedProviderRetryManually({
                workspaceId,
                threadId,
                engine: overlay.engine,
                providerProfileId: overlay.providerProfileId,
                model: overlay.model,
                attemptId: null,
                message: overlay.lastMessage,
                wasLocalInterrupt: false,
              })
            }
          >
            <RefreshCw size={10} strokeWidth={2.4} aria-hidden />
            {t("sharedSend.providerRetryAgain")}
          </button>
        ) : null}
      </span>
    </div>
  );
}
