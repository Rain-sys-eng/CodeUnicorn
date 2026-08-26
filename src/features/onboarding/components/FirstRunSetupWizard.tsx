import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CliInstallEngine, EngineStatus } from "../../../types";
import appLogo from "../../../assets/icon.png";
import { useKnownOpenAppIcons } from "../../app/hooks/useKnownOpenAppIcons";
import { getKnownOpenAppIcon, GENERIC_APP_ICON } from "../../app/utils/openAppIcons";
import {
  FIRST_RUN_ENGINE_META,
  FIRST_RUN_IDE_META,
} from "../constants";
import {
  FIRST_RUN_IDE_CHOICES,
  FIRST_RUN_SETUP_STEPS,
  type FirstRunIdeId,
  type FirstRunSetupProfile,
  type FirstRunSetupStep,
} from "../types";
import { resolveFirstRunPrimaryEngine } from "../utils/resolvePrimaryEngine";
import { FirstRunChoiceCard } from "./FirstRunChoiceCard";
import {
  FirstRunCliStep,
  type FirstRunEngineCardState,
} from "./FirstRunCliStep";
import { FirstRunFluidBackdrop } from "./FirstRunFluidBackdrop";

type FirstRunSetupWizardProps = {
  profile: FirstRunSetupProfile;
  step: FirstRunSetupStep;
  onStepChange: (step: FirstRunSetupStep) => void;
  onIdeChange: (ide: FirstRunIdeId) => void;
  selectedEngine: CliInstallEngine | null;
  onSelectEngine: (engine: CliInstallEngine) => void;
  engineStatuses: EngineStatus[];
  cardStateByEngine: Partial<Record<CliInstallEngine, FirstRunEngineCardState>>;
  onInstall: (engine: CliInstallEngine) => void;
  detecting: boolean;
  onContinueFromWelcome: () => void;
  onSkipCli: () => void;
  onEnterApp: () => void;
};

function stepIndex(step: FirstRunSetupStep): number {
  return FIRST_RUN_SETUP_STEPS.indexOf(step);
}

export function FirstRunSetupWizard({
  profile,
  step,
  onStepChange,
  onIdeChange,
  selectedEngine,
  onSelectEngine,
  engineStatuses,
  cardStateByEngine,
  onInstall,
  detecting,
  onContinueFromWelcome,
  onSkipCli,
  onEnterApp,
}: FirstRunSetupWizardProps) {
  const { t } = useTranslation();
  // Built-in open-app PNGs load lazily; this re-renders once they are cached
  // so the IDE choice card swaps from the generic glyph to the real logo.
  useKnownOpenAppIcons();
  const currentIndex = stepIndex(step);
  const canGoBack = currentIndex > 0;
  const hasReadyCli =
    profile.validatedEngines.length > 0 ||
    Object.values(cardStateByEngine).some((card) => card?.installed) ||
    engineStatuses.some((status) => status.installed);

  const primaryAction = useMemo(() => {
    switch (step) {
      case "welcome":
        return {
          label: t("onboarding.welcome.start"),
          onClick: onContinueFromWelcome,
          disabled: false,
        };
      case "ide":
        return {
          label: t("onboarding.common.continue"),
          onClick: () => onStepChange("cli"),
          disabled: profile.preferredIde === null,
        };
      case "cli":
        return {
          label: hasReadyCli
            ? t("onboarding.cli.continueReady")
            : t("onboarding.cli.skip"),
          onClick: hasReadyCli ? () => onStepChange("done") : onSkipCli,
          disabled: false,
        };
      case "done":
        return {
          label: t("onboarding.done.enter"),
          onClick: onEnterApp,
          disabled: false,
        };
      default:
        return {
          label: t("onboarding.common.continue"),
          onClick: () => undefined,
          disabled: true,
        };
    }
  }, [
    hasReadyCli,
    onContinueFromWelcome,
    onEnterApp,
    onSkipCli,
    onStepChange,
    profile.preferredIde,
    step,
    t,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }
      if (event.key !== "Enter" || event.defaultPrevented) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (primaryAction.disabled) {
        return;
      }
      event.preventDefault();
      primaryAction.onClick();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [primaryAction]);

  const ideLabel = profile.preferredIde
    ? t(FIRST_RUN_IDE_META[profile.preferredIde].titleKey)
    : t("onboarding.done.unset");
  const summaryEngine = resolveFirstRunPrimaryEngine({
    selectedEngine,
    profile,
    engineStatuses,
    cardStateByEngine,
  });
  const highlightedEngine = selectedEngine ?? summaryEngine;
  const summaryEngineMeta =
    summaryEngine && summaryEngine in FIRST_RUN_ENGINE_META
      ? FIRST_RUN_ENGINE_META[summaryEngine as keyof typeof FIRST_RUN_ENGINE_META]
      : null;
  const engineLabel = summaryEngineMeta
    ? t(summaryEngineMeta.titleKey)
    : hasReadyCli && summaryEngine
      ? summaryEngine
      : t("onboarding.done.cliSkipped");

  return (
    <div
      className="first-run-setup"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-setup-title"
      data-testid="first-run-setup"
    >
      <FirstRunFluidBackdrop />
      <button
        type="button"
        className="first-run-skip-all"
        onClick={onEnterApp}
      >
        {t("onboarding.common.skipAll")}
      </button>
      <div className="first-run-setup-stage">
        <div key={step} className="first-run-step-pane">
          {step === "welcome" ? (
            <div className="first-run-welcome">
              <img
                className="first-run-logo"
                src={appLogo}
                alt=""
                width={72}
                height={72}
              />
              <h1 id="first-run-setup-title">{t("onboarding.welcome.title")}</h1>
              <p>{t("onboarding.welcome.subtitle")}</p>
            </div>
          ) : null}

          {step === "ide" ? (
            <div className="first-run-stack">
              <header className="first-run-copy">
                <h1 id="first-run-setup-title">{t("onboarding.ide.title")}</h1>
                <p>{t("onboarding.ide.subtitle")}</p>
              </header>
              <div className="first-run-choice-list" role="list">
                {FIRST_RUN_IDE_CHOICES.map((ide) => {
                  const openAppId = FIRST_RUN_IDE_META[ide].openAppId;
                  return (
                    <FirstRunChoiceCard
                      key={ide}
                      selected={profile.preferredIde === ide}
                      title={t(FIRST_RUN_IDE_META[ide].titleKey)}
                      hint={t(FIRST_RUN_IDE_META[ide].hintKey)}
                      icon={
                        <img
                          src={
                            openAppId
                              ? (getKnownOpenAppIcon(openAppId) ?? GENERIC_APP_ICON)
                              : appLogo
                          }
                          alt=""
                        />
                      }
                      onSelect={() => onIdeChange(ide)}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}

          {step === "cli" ? (
            <FirstRunCliStep
              selectedEngine={highlightedEngine}
              onSelectEngine={onSelectEngine}
              engineStatuses={engineStatuses}
              cardStateByEngine={cardStateByEngine}
              onInstall={onInstall}
              detecting={detecting}
            />
          ) : null}

          {step === "done" ? (
            <div className="first-run-stack first-run-done">
              <header className="first-run-copy">
                <h1 id="first-run-setup-title">{t("onboarding.done.title")}</h1>
                <p>{t("onboarding.done.subtitle")}</p>
              </header>
              <dl className="first-run-summary">
                <div>
                  <dt>{t("onboarding.done.ide")}</dt>
                  <dd>{ideLabel}</dd>
                </div>
                <div>
                  <dt>{t("onboarding.done.engine")}</dt>
                  <dd>{engineLabel}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </div>

        <div className="first-run-footer">
          <button
            type="button"
            className="first-run-primary"
            disabled={primaryAction.disabled}
            onClick={primaryAction.onClick}
          >
            {primaryAction.label}
          </button>
          {canGoBack ? (
            <div className="first-run-footer-links">
              <button
                type="button"
                className="first-run-text-button"
                onClick={() =>
                  onStepChange(FIRST_RUN_SETUP_STEPS[currentIndex - 1] ?? "welcome")
                }
              >
                {t("onboarding.common.back")}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div
        className="first-run-dots"
        aria-hidden
        data-testid="first-run-progress"
      >
        {FIRST_RUN_SETUP_STEPS.map((entry) => (
          <span
            key={entry}
            className={entry === step ? "is-active" : undefined}
          />
        ))}
      </div>
    </div>
  );
}
