import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { loadAboutStyles } from "../../../styles/featureStyleLoaders";
import { getAppSettings } from "../../../services/tauri";
import { useDockIconSrc } from "../../theme/hooks/useDockIconSrc";
import {
  applyDockIconPreference,
  DEFAULT_DOCK_ICON_ID,
} from "../../theme/utils/dockIcon";

const GITHUB_URL = "https://github.com/zhukunpenglinyutong/desktop-cc-gui";

export function AboutView() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const [dockIconId, setDockIconId] = useState<unknown>(DEFAULT_DOCK_ICON_ID);
  // Loads the icon URL from its lazy chunk; null for one brief paint.
  const logoSrc = useDockIconSrc(dockIconId);
  useEffect(() => {
    void loadAboutStyles();
  }, []);

  const handleOpenGitHub = () => {
    void openUrl(GITHUB_URL);
  };

  useEffect(() => {
    let active = true;
    const fetchVersion = async () => {
      try {
        const value = await getVersion();
        if (active) {
          setVersion(value);
        }
      } catch {
        if (active) {
          setVersion(null);
        }
      }
    };

    void fetchVersion();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const settings = await getAppSettings();
        if (!active) {
          return;
        }
        setDockIconId(settings.dockIconId);
        // Win/Linux: icons are per-window. Re-apply so the About surface inherits
        // the current preference (macOS Dock is process-wide and already set).
        void applyDockIconPreference(settings.dockIconId).catch((error) => {
          console.error("[AboutView] failed to apply dock icon", error);
        });
      } catch {
        // Keep default logo when settings are unavailable.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="about">
      <div className="about-card">
        <div className="about-header">
          {logoSrc ? (
            <img
              className="about-icon"
              src={logoSrc}
              alt="ccgui icon"
            />
          ) : (
            <span className="about-icon" aria-hidden />
          )}
          <div className="about-title">ccgui</div>
        </div>
        <div className="about-version">
          {version ? `${t("about.version")} ${version}` : `${t("about.version")} —`}
        </div>
        <div className="about-tagline">
          {t("about.tagline")}
        </div>
        <div className="about-divider" />
        <div className="about-links">
          <button
            type="button"
            className="about-link"
            onClick={handleOpenGitHub}
          >
            {t("about.github")}
          </button>
        </div>
      </div>
    </div>
  );
}
