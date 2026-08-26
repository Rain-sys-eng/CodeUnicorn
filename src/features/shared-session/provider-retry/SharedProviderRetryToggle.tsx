import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Clock3 from "lucide-react/dist/esm/icons/clock-3";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Repeat2 from "lucide-react/dist/esm/icons/repeat-2";
import Timer from "lucide-react/dist/esm/icons/timer";
import Type from "lucide-react/dist/esm/icons/type";

import { Switch } from "@/components/ui/switch";
import { resolveEngineLabel } from "../../../utils/turnBadge";
import type { EngineType } from "../../../types";
import {
  setSharedProviderRetrySettings,
  useSharedProviderRetrySettings,
} from "./providerRetrySettingsStore";
import {
  SHARED_PROVIDER_RETRY_DEFAULTS,
  type SharedProviderRetryBackoff,
} from "./providerRetryPolicy";

type SharedProviderRetryToggleProps = {
  workspaceId: string | null | undefined;
  threadId: string | null | undefined;
  engine: EngineType | null | undefined;
  disabled?: boolean;
};

function FieldLabel({
  icon: Icon,
  children,
}: {
  icon: typeof RefreshCw;
  children: string;
}) {
  return (
    <span className="shared-provider-retry-pop__label">
      <Icon size={12} strokeWidth={2} aria-hidden />
      {children}
    </span>
  );
}

export function SharedProviderRetryToggle({
  workspaceId,
  threadId,
  engine,
  disabled = false,
}: SharedProviderRetryToggleProps) {
  const { t } = useTranslation();
  const settings = useSharedProviderRetrySettings(workspaceId, threadId, engine);
  const [popOpen, setPopOpen] = useState(false);
  const [backoffOpen, setBackoffOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [popPos, setPopPos] = useState<{
    left: number;
    bottom: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!popOpen || !btnRef.current) {
      setPopPos(null);
      return;
    }
    const place = () => {
      const rect = btnRef.current!.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 308), Math.min(336, window.innerWidth - 16));
      let left = rect.right - width;
      if (left < 8) {
        left = 8;
      }
      setPopPos({
        left,
        bottom: window.innerHeight - rect.top + 8,
        width,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [popOpen]);

  useEffect(() => {
    if (!popOpen) {
      setBackoffOpen(false);
      return;
    }
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popRef.current?.contains(target)) {
        return;
      }
      setPopOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [popOpen]);

  if (!workspaceId || !threadId || !engine) {
    return null;
  }

  const write = (patch: Parameters<typeof setSharedProviderRetrySettings>[3]) => {
    setSharedProviderRetrySettings(workspaceId, threadId, engine, patch);
  };
  const autoOn = settings.enabled && settings.maxAttempts > 0;
  const pillLabel = autoOn
    ? t("sharedSend.providerRetryPillOn", { count: settings.maxAttempts })
    : t("sharedSend.providerRetryPillOff");
  const backoffLabel =
    settings.backoff === "fixed"
      ? t("sharedSend.providerRetryBackoffFixed")
      : t("sharedSend.providerRetryBackoffExp");

  const popover =
    popOpen && popPos
      ? createPortal(
          <div
            ref={popRef}
            className="shared-provider-retry-pop"
            role="dialog"
            aria-label={t("sharedSend.providerRetryTitle")}
            style={{
              position: "fixed",
              left: popPos.left,
              bottom: popPos.bottom,
              width: popPos.width,
              zIndex: 80,
            }}
          >
            <div className="shared-provider-retry-pop__head">
              <span className="shared-provider-retry-pop__mark" aria-hidden>
                <RefreshCw size={13} strokeWidth={2.2} />
              </span>
              <div className="shared-provider-retry-pop__titles">
                <h3>{t("sharedSend.providerRetryTitle")}</h3>
                <p>
                  {t("sharedSend.providerRetryScope", {
                    cli: resolveEngineLabel(engine),
                  })}
                </p>
              </div>
            </div>

            <div className="shared-provider-retry-pop__switch">
              <div className="shared-provider-retry-pop__switch-copy">
                <span>{t("sharedSend.providerRetryEnabled")}</span>
                <em>
                  {autoOn
                    ? t("sharedSend.providerRetryPillOn", {
                        count: settings.maxAttempts,
                      })
                    : t("sharedSend.providerRetryPillOff")}
                </em>
              </div>
              <Switch
                checked={settings.enabled}
                aria-label={t("sharedSend.providerRetryEnabled")}
                onCheckedChange={(checked) => write({ enabled: checked })}
              />
            </div>

            <div className="shared-provider-retry-pop__grid">
              <label>
                <FieldLabel icon={Repeat2}>
                  {t("sharedSend.providerRetryMax")}
                </FieldLabel>
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={settings.maxAttempts}
                  onChange={(event) =>
                    write({ maxAttempts: Number(event.target.value) })
                  }
                />
              </label>
              <div className="shared-provider-retry-pop__field">
                <FieldLabel icon={RefreshCw}>
                  {t("sharedSend.providerRetryBackoff")}
                </FieldLabel>
                <div className="shared-provider-retry-pop__select">
                  <button
                    type="button"
                    className={`shared-provider-retry-pop__select-btn${backoffOpen ? " is-open" : ""}`}
                    aria-haspopup="listbox"
                    aria-expanded={backoffOpen}
                    onClick={() => setBackoffOpen((open) => !open)}
                  >
                    <span>{backoffLabel}</span>
                    <ChevronDown size={13} strokeWidth={2} aria-hidden />
                  </button>
                  {backoffOpen ? (
                    <div
                      className="shared-provider-retry-pop__select-menu"
                      role="listbox"
                    >
                      {(["exponential", "fixed"] as SharedProviderRetryBackoff[]).map(
                        (value) => (
                          <button
                            key={value}
                            type="button"
                            role="option"
                            aria-selected={settings.backoff === value}
                            className={
                              settings.backoff === value ? "is-selected" : undefined
                            }
                            onClick={() => {
                              write({ backoff: value });
                              setBackoffOpen(false);
                            }}
                          >
                            {value === "fixed"
                              ? t("sharedSend.providerRetryBackoffFixed")
                              : t("sharedSend.providerRetryBackoffExp")}
                          </button>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
              <label>
                <FieldLabel icon={Clock3}>
                  {t("sharedSend.providerRetryBase")}
                </FieldLabel>
                <span className="shared-provider-retry-pop__input-wrap">
                  <input
                    type="number"
                    min={1}
                    max={1200}
                    value={settings.baseDelaySec}
                    onChange={(event) =>
                      write({ baseDelaySec: Number(event.target.value) })
                    }
                  />
                  <span className="shared-provider-retry-pop__unit">
                    {t("sharedSend.providerRetryUnit")}
                  </span>
                </span>
              </label>
              <label>
                <FieldLabel icon={Timer}>
                  {t("sharedSend.providerRetryCap")}
                </FieldLabel>
                <span className="shared-provider-retry-pop__input-wrap">
                  <input
                    type="number"
                    min={1}
                    max={1200}
                    value={settings.maxDelaySec}
                    onChange={(event) =>
                      write({ maxDelaySec: Number(event.target.value) })
                    }
                  />
                  <span className="shared-provider-retry-pop__unit">
                    {t("sharedSend.providerRetryUnit")}
                  </span>
                </span>
              </label>
            </div>
            <p className="shared-provider-retry-pop__hint">
              {t("sharedSend.providerRetryDelayHint")}
            </p>

            <label className="shared-provider-retry-pop__prompt">
              <FieldLabel icon={Type}>
                {t("sharedSend.providerRetryPrompt")}
              </FieldLabel>
              <textarea
                value={settings.resumePrompt}
                placeholder={SHARED_PROVIDER_RETRY_DEFAULTS.resumePrompt}
                onChange={(event) => write({ resumePrompt: event.target.value })}
              />
            </label>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="shared-provider-retry-wrap" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className={`shared-provider-retry-pill${popOpen ? " is-open" : ""}${autoOn ? " is-on" : ""}`}
        aria-expanded={popOpen}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setPopOpen((open) => !open)}
      >
        <RefreshCw size={12} strokeWidth={2.2} aria-hidden />
        {pillLabel}
      </button>
      {popover}
    </div>
  );
}
