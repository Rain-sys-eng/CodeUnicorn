import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_VISIBLE_THREAD_ROOT_COUNT,
  MAX_GLOBAL_VISIBLE_THREAD_ROOT_COUNT,
  MIN_VISIBLE_THREAD_ROOT_COUNT,
  normalizeGlobalVisibleThreadRootCount,
  parseVisibleThreadRootCountDraft,
} from "../constants";

type WorkspaceSettingsDialogProps = {
  open: boolean;
  defaultVisibleThreadRootCount: number;
  onOpenChange: (open: boolean) => void;
  onSaveDefaultVisibleThreadRootCount: (count: number) => void | Promise<unknown>;
};

export function WorkspaceSettingsDialog({
  open,
  defaultVisibleThreadRootCount,
  onOpenChange,
  onSaveDefaultVisibleThreadRootCount,
}: WorkspaceSettingsDialogProps) {
  const { t } = useTranslation();
  const effectiveCount = normalizeGlobalVisibleThreadRootCount(
    defaultVisibleThreadRootCount,
  );
  const [draft, setDraft] = useState(String(effectiveCount));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraft(String(effectiveCount));
  }, [effectiveCount, open]);

  const persistDraft = async () => {
    const next = normalizeGlobalVisibleThreadRootCount(
      parseVisibleThreadRootCountDraft(draft),
    );
    setDraft(String(next));
    if (next === effectiveCount) {
      return;
    }
    setIsSaving(true);
    try {
      await onSaveDefaultVisibleThreadRootCount(next);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="workspace-settings-dialog gap-0 p-0 sm:max-w-md"
        data-testid="workspace-settings-dialog"
      >
        <DialogHeader className="gap-1 p-6 pb-4">
          <DialogTitle>{t("sidebar.workspaceSettingsTitle")}</DialogTitle>
          <DialogDescription>
            {t("sidebar.workspaceSettingsDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="workspace-settings-dialog-body px-6 pb-6">
          <div className="workspace-settings-pref-row">
            <div className="workspace-settings-pref-meta">
              <div className="workspace-settings-pref-title">
                {t("sidebar.workspaceSettingsVisibleCountLabel")}
              </div>
              <div className="workspace-settings-pref-desc">
                {t("sidebar.workspaceSettingsVisibleCountHint", {
                  defaultCount: DEFAULT_VISIBLE_THREAD_ROOT_COUNT,
                  min: MIN_VISIBLE_THREAD_ROOT_COUNT,
                  max: MAX_GLOBAL_VISIBLE_THREAD_ROOT_COUNT,
                })}
              </div>
            </div>
            <div className="workspace-settings-pref-control">
              <Input
                data-testid="workspace-settings-visible-count-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                  void persistDraft();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={isSaving}
                className="h-8 w-20"
                aria-label={t("sidebar.workspaceSettingsVisibleCountLabel")}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
