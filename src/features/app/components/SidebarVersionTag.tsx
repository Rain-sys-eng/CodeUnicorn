import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

type SidebarVersionTagProps = {
  t: (key: string) => string;
  onOpenReleaseNotes: () => void;
};

/**
 * SidebarVersionTag - 侧栏底部的外显版本号
 * 无边框 caption：跟齿轮/折叠箭头同一套 chrome，不画胶囊。
 * 文字色走主题 token，避免浅色/深色壁纸下硬描边芯片突兀。
 * 点击打开版本记录弹窗。版本号自取自 Tauri（与 AboutView 一致）。
 */
export function SidebarVersionTag({ t, onOpenReleaseNotes }: SidebarVersionTagProps) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getVersion()
      .then((value) => {
        if (active) {
          setVersion(value);
        }
      })
      .catch(() => {
        if (active) {
          setVersion(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (!version) {
    return null;
  }

  const label = t("sidebar.releaseNotes");

  return (
    <button
      type="button"
      className="sidebar-version-tag"
      onClick={onOpenReleaseNotes}
      title={label}
      aria-label={label}
    >
      v{version}
    </button>
  );
}

export default SidebarVersionTag;
