import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  downloadWorkspaceWallpaper,
  importWorkspaceWallpaper,
  removeWorkspaceWallpaper,
  searchWorkspaceWallpaperMarket,
  type WallpaperMarketCategory,
  type WallpaperMarketItem,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type {
  WorkspaceWallpaperLibraryItem,
  WorkspaceWallpaperSettings,
} from "../../../types";
import { useManagedWallpaperSrc } from "../utils/useManagedWallpaperSrc";
import {
  WORKSPACE_WALLPAPER_MEDIA_EXTENSIONS,
  findDuplicateWallpaperLibraryItem,
  resolveSelectedLibraryId,
  sanitizeWorkspaceWallpaper,
  visibleWallpaperLibraryItems,
  wallpaperFileName,
} from "../utils/workspaceWallpaper";

type LibraryFilter = "all" | "image" | "video";
type PickerTab = "library" | "market";

const MARKET_CATEGORIES: WallpaperMarketCategory[] = [
  "all",
  "general",
  "anime",
  "people",
];

type WorkspaceWallpaperPickerProps = {
  open: boolean;
  wallpaper: WorkspaceWallpaperSettings;
  onClose: () => void;
  onChange: (next: Partial<WorkspaceWallpaperSettings>) => void;
};

function filterLibrary(
  library: WorkspaceWallpaperLibraryItem[],
  filter: LibraryFilter,
  hiddenOnly: boolean,
): WorkspaceWallpaperLibraryItem[] {
  return library.filter((item) => {
    if (hiddenOnly ? item.hidden !== true : item.hidden === true) {
      return false;
    }
    if (filter === "all") {
      return true;
    }
    return item.kind === filter;
  });
}

export function WorkspaceWallpaperPicker({
  open,
  wallpaper,
  onClose,
  onChange,
}: WorkspaceWallpaperPickerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PickerTab>("library");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [showHidden, setShowHidden] = useState(false);
  const [importing, setImporting] = useState(false);
  const [marketQuery, setMarketQuery] = useState("");
  const [marketCategory, setMarketCategory] =
    useState<WallpaperMarketCategory>("all");
  const [marketPage, setMarketPage] = useState(1);
  const [marketLastPage, setMarketLastPage] = useState(1);
  const [marketItems, setMarketItems] = useState<WallpaperMarketItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const library = wallpaper.library ?? [];
  const selectedId = resolveSelectedLibraryId(
    library,
    wallpaper.selectedLibraryId,
  );
  const hiddenCount = library.length - visibleWallpaperLibraryItems(library).length;
  const items = useMemo(
    () => filterLibrary(library, filter, showHidden),
    [filter, library, showHidden],
  );

  const persistLibrary = (
    nextLibrary: WorkspaceWallpaperLibraryItem[],
    selectedLibraryId?: string | null,
  ) => {
    onChange({
      mode: "custom",
      library: nextLibrary,
      selectedLibraryId:
        selectedLibraryId === undefined
          ? resolveSelectedLibraryId(nextLibrary, wallpaper.selectedLibraryId)
          : selectedLibraryId,
    });
  };

  useEffect(() => {
    if (!open) {
      setTab("library");
      setShowHidden(false);
      setDownloadingId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || tab !== "market") {
      return undefined;
    }
    let active = true;
    const handle = window.setTimeout(() => {
      setMarketLoading(true);
      setMarketError(null);
      void searchWorkspaceWallpaperMarket({
        query: marketQuery,
        category: marketCategory,
        page: marketPage,
      })
        .then((result) => {
          if (!active) {
            return;
          }
          setMarketItems(result.items);
          setMarketLastPage(Math.max(1, result.lastPage));
          setMarketPage(Math.max(1, result.page));
        })
        .catch((error) => {
          if (!active) {
            return;
          }
          setMarketItems([]);
          setMarketError(
            error instanceof Error
              ? error.message
              : t("settings.workspaceWallpaperMarketFailed"),
          );
        })
        .finally(() => {
          if (active) {
            setMarketLoading(false);
          }
        });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [marketCategory, marketPage, marketQuery, open, t, tab]);

  const handleImport = async () => {
    const selection = await openFileDialog({
      multiple: true,
      directory: false,
      filters: [
        {
          name: "Media",
          extensions: WORKSPACE_WALLPAPER_MEDIA_EXTENSIONS,
        },
      ],
    });
    const paths = Array.isArray(selection)
      ? selection
      : typeof selection === "string"
        ? [selection]
        : [];
    const uniquePaths = paths.map((path) => path.trim()).filter(Boolean);
    if (uniquePaths.length === 0) {
      return;
    }
    setImporting(true);
    let nextLibrary = [...library];
    let lastSelected: string | null = selectedId;
    try {
      for (const sourcePath of uniquePaths) {
        const duplicate = findDuplicateWallpaperLibraryItem(
          nextLibrary,
          sourcePath,
        );
        if (duplicate) {
          lastSelected = duplicate.id;
          nextLibrary = nextLibrary.map((item) =>
            item.id === duplicate.id ? { ...item, hidden: false } : item,
          );
          continue;
        }
        const imported = await importWorkspaceWallpaper(sourcePath);
        nextLibrary = [
          ...nextLibrary,
          {
            id: imported.id,
            kind: imported.kind,
            path: imported.path,
            sourcePath: imported.sourcePath,
            hidden: false,
          },
        ];
        lastSelected = imported.id;
      }
      persistLibrary(nextLibrary, lastSelected);
      setShowHidden(false);
    } catch (error) {
      pushErrorToast({
        title: t("settings.workspaceWallpaperImportFailed"),
        message:
          error instanceof Error
            ? error.message
            : t("settings.workspaceWallpaperImportFailed"),
      });
    } finally {
      setImporting(false);
    }
  };

  const handleHide = (id: string) => {
    persistLibrary(
      library.map((item) =>
        item.id === id ? { ...item, hidden: true } : item,
      ),
    );
  };

  const handleRestore = (id: string) => {
    persistLibrary(
      library.map((item) =>
        item.id === id ? { ...item, hidden: false } : item,
      ),
      id,
    );
    setShowHidden(false);
  };

  const handleRemove = async (item: WorkspaceWallpaperLibraryItem) => {
    try {
      await removeWorkspaceWallpaper(item.path);
    } catch {
      // File may already be gone; still drop the library row.
    }
    persistLibrary(library.filter((entry) => entry.id !== item.id));
  };

  const handleSelectMarketItem = async (item: WallpaperMarketItem) => {
    const duplicate = findDuplicateWallpaperLibraryItem(library, item.sourceUrl);
    if (duplicate) {
      persistLibrary(
        library.map((entry) =>
          entry.id === duplicate.id ? { ...entry, hidden: false } : entry,
        ),
        duplicate.id,
      );
      onClose();
      return;
    }
    setDownloadingId(item.id);
    try {
      const imported = await downloadWorkspaceWallpaper({
        url: item.fullUrl,
        sourceUrl: item.sourceUrl,
        suggestedName: item.id,
      });
      persistLibrary(
        [
          ...library,
          {
            id: imported.id,
            kind: imported.kind,
            path: imported.path,
            sourcePath: imported.sourcePath,
            hidden: false,
          },
        ],
        imported.id,
      );
      onClose();
    } catch (error) {
      pushErrorToast({
        title: t("settings.workspaceWallpaperDownloadFailed"),
        message:
          error instanceof Error
            ? error.message
            : t("settings.workspaceWallpaperDownloadFailed"),
      });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="settings-wallpaper-picker-dialog !max-w-[min(920px,calc(100%-2rem))] sm:!max-w-[920px]"
        data-testid="settings-workspace-wallpaper-picker"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>{t("settings.workspaceWallpaperPickerTitle")}</DialogTitle>
          <DialogDescription>
            {t("settings.workspaceWallpaperPickerDesc")}
          </DialogDescription>
        </DialogHeader>
        <div
          className="settings-pref-segmented"
          role="tablist"
          aria-label={t("settings.workspaceWallpaperPickerTabs")}
        >
          {(["library", "market"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={`settings-pref-segment${tab === value ? " is-active" : ""}`}
              onClick={() => setTab(value)}
            >
              {t(`settings.workspaceWallpaperTab_${value}`)}
            </button>
          ))}
        </div>
        {tab === "library" ? (
          <>
            <div className="settings-wallpaper-picker-toolbar">
              <div
                className="settings-pref-segmented"
                role="radiogroup"
                aria-label={t("settings.workspaceWallpaperFilter")}
              >
                {(["all", "image", "video"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={filter === value}
                    className={`settings-pref-segment${filter === value ? " is-active" : ""}`}
                    onClick={() => setFilter(value)}
                  >
                    {t(`settings.workspaceWallpaperFilter_${value}`)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="settings-web-btn"
                aria-pressed={showHidden}
                onClick={() => setShowHidden((current) => !current)}
              >
                {showHidden
                  ? t("settings.workspaceWallpaperShowVisible")
                  : t("settings.workspaceWallpaperShowHidden", {
                      count: hiddenCount,
                    })}
              </button>
              <button
                type="button"
                className="settings-web-btn settings-web-btn--primary"
                disabled={importing}
                onClick={() => {
                  void handleImport();
                }}
              >
                {importing
                  ? t("settings.workspaceWallpaperImporting")
                  : t("settings.workspaceWallpaperImport")}
              </button>
            </div>
            {items.length === 0 ? (
              <div className="settings-wallpaper-picker-empty">
                {showHidden
                  ? t("settings.workspaceWallpaperHiddenEmpty")
                  : t("settings.workspaceWallpaperLibraryEmpty")}
              </div>
            ) : (
              <div className="settings-wallpaper-picker-grid" role="list">
                {items.map((item) => (
                  <LibraryWallpaperCard
                    key={item.id}
                    item={item}
                    active={item.id === selectedId && item.hidden !== true}
                    onSelect={() => {
                      if (item.hidden) {
                        handleRestore(item.id);
                        return;
                      }
                      persistLibrary(library, item.id);
                      onClose();
                    }}
                    onHide={() => handleHide(item.id)}
                    onRestore={() => handleRestore(item.id)}
                    onRemove={() => {
                      void handleRemove(item);
                    }}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="settings-wallpaper-picker-toolbar">
              <input
                type="search"
                className="settings-wallpaper-market-search"
                value={marketQuery}
                placeholder={t("settings.workspaceWallpaperMarketSearch")}
                aria-label={t("settings.workspaceWallpaperMarketSearch")}
                onChange={(event) => {
                  setMarketQuery(event.target.value);
                  setMarketPage(1);
                }}
              />
              <div
                className="settings-pref-segmented"
                role="radiogroup"
                aria-label={t("settings.workspaceWallpaperMarketCategory")}
              >
                {MARKET_CATEGORIES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={marketCategory === value}
                    className={`settings-pref-segment${marketCategory === value ? " is-active" : ""}`}
                    onClick={() => {
                      setMarketCategory(value);
                      setMarketPage(1);
                    }}
                  >
                    {t(`settings.workspaceWallpaperMarketCategory_${value}`)}
                  </button>
                ))}
              </div>
            </div>
            {marketLoading ? (
              <div className="settings-wallpaper-picker-empty">
                {t("settings.workspaceWallpaperMarketLoading")}
              </div>
            ) : marketError ? (
              <div className="settings-wallpaper-picker-empty">
                <span>{marketError}</span>
                <button
                  type="button"
                  className="settings-web-btn"
                  onClick={() => {
                    setMarketPage((current) => current);
                    setMarketError(null);
                    setMarketLoading(true);
                    void searchWorkspaceWallpaperMarket({
                      query: marketQuery,
                      category: marketCategory,
                      page: marketPage,
                    })
                      .then((result) => {
                        setMarketItems(result.items);
                        setMarketLastPage(Math.max(1, result.lastPage));
                      })
                      .catch((error) => {
                        setMarketItems([]);
                        setMarketError(
                          error instanceof Error
                            ? error.message
                            : t("settings.workspaceWallpaperMarketFailed"),
                        );
                      })
                      .finally(() => setMarketLoading(false));
                  }}
                >
                  {t("settings.workspaceWallpaperMarketRetry")}
                </button>
              </div>
            ) : marketItems.length === 0 ? (
              <div className="settings-wallpaper-picker-empty">
                {t("settings.workspaceWallpaperMarketEmpty")}
              </div>
            ) : (
              <div className="settings-wallpaper-picker-grid" role="list">
                {marketItems.map((item) => {
                  const inLibrary = Boolean(
                    findDuplicateWallpaperLibraryItem(library, item.sourceUrl),
                  );
                  const busy = downloadingId === item.id;
                  const label = item.resolution
                    ? `${item.id} · ${item.resolution}`
                    : item.id;
                  return (
                    <div
                      key={item.id}
                      className={`settings-wallpaper-picker-card${inLibrary ? " is-active" : ""}`}
                      role="listitem"
                    >
                      <button
                        type="button"
                        className="settings-wallpaper-picker-thumb"
                        aria-label={t("settings.workspaceWallpaperDownload", {
                          name: label,
                        })}
                        disabled={busy}
                        onClick={() => {
                          void handleSelectMarketItem(item);
                        }}
                      >
                        <img src={item.thumbUrl} alt="" />
                        <span className="settings-wallpaper-picker-kind">
                          {busy
                            ? t("settings.workspaceWallpaperDownloading")
                            : inLibrary
                              ? t("settings.workspaceWallpaperInLibrary")
                              : t("settings.workspaceWallpaperDownloadAction")}
                        </span>
                      </button>
                      <div className="settings-wallpaper-picker-meta">
                        <span className="settings-wallpaper-picker-name" title={label}>
                          {label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {marketLastPage > 1 ? (
              <div className="settings-wallpaper-picker-pager">
                <button
                  type="button"
                  className="settings-web-btn"
                  disabled={marketPage <= 1 || marketLoading}
                  onClick={() => setMarketPage((current) => Math.max(1, current - 1))}
                >
                  {t("settings.workspaceWallpaperMarketPrev")}
                </button>
                <span>
                  {t("settings.workspaceWallpaperMarketPage", {
                    page: marketPage,
                    last: marketLastPage,
                  })}
                </span>
                <button
                  type="button"
                  className="settings-web-btn"
                  disabled={marketPage >= marketLastPage || marketLoading}
                  onClick={() =>
                    setMarketPage((current) => Math.min(marketLastPage, current + 1))
                  }
                >
                  {t("settings.workspaceWallpaperMarketNext")}
                </button>
              </div>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LibraryWallpaperCard({
  item,
  active,
  onSelect,
  onHide,
  onRestore,
  onRemove,
}: {
  item: WorkspaceWallpaperLibraryItem;
  active: boolean;
  onSelect: () => void;
  onHide: () => void;
  onRestore: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const preview = useManagedWallpaperSrc(item.path, item.kind);
  const label = wallpaperFileName(item.sourcePath ?? item.path) || item.id;
  return (
    <div
      className={`settings-wallpaper-picker-card${active ? " is-active" : ""}`}
      role="listitem"
    >
      <button
        type="button"
        className="settings-wallpaper-picker-thumb"
        aria-pressed={active}
        aria-label={label}
        onClick={onSelect}
      >
        {item.kind === "video" ? (
          <video
            src={preview.src}
            muted
            playsInline
            preload="metadata"
            onError={preview.handleError}
          />
        ) : (
          <img src={preview.src} alt="" onError={preview.handleError} />
        )}
        <span className="settings-wallpaper-picker-kind">
          {t(`settings.workspaceWallpaperKind_${item.kind}`)}
        </span>
      </button>
      <div className="settings-wallpaper-picker-meta">
        <span className="settings-wallpaper-picker-name" title={label}>
          {label}
        </span>
        {item.hidden ? (
          <button
            type="button"
            className="settings-pref-reset"
            onClick={onRestore}
          >
            {t("settings.workspaceWallpaperRestore")}
          </button>
        ) : (
          <button type="button" className="settings-pref-reset" onClick={onHide}>
            {t("settings.workspaceWallpaperHide")}
          </button>
        )}
        <button type="button" className="settings-pref-reset" onClick={onRemove}>
          {t("settings.workspaceWallpaperRemove")}
        </button>
      </div>
    </div>
  );
}

export function currentWallpaperLabel(
  wallpaper: WorkspaceWallpaperSettings,
): string | null {
  const sanitized = sanitizeWorkspaceWallpaper(wallpaper);
  const selectedId = resolveSelectedLibraryId(
    sanitized.library ?? [],
    sanitized.selectedLibraryId,
  );
  const selected = (sanitized.library ?? []).find(
    (item) => item.id === selectedId,
  );
  if (selected) {
    return wallpaperFileName(selected.sourcePath ?? selected.path);
  }
  if (sanitized.customImagePath) {
    return wallpaperFileName(sanitized.customImagePath);
  }
  return null;
}
