import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import FolderGit2 from "lucide-react/dist/esm/icons/folder-git-2";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import GitCommitHorizontal from "lucide-react/dist/esm/icons/git-commit-horizontal";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import PlusIcon from "lucide-react/dist/esm/icons/plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Upload from "lucide-react/dist/esm/icons/upload";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type {
  BranchInfo,
  GitBranchListItem,
  GitRepositorySummary,
  GitBranchUpdateResult,
} from "../../../types";
import { gitRepositoryStatusItems } from "../../git/utils/gitRepositorySummary";
import { getGitBranchUpdateFeedback } from "../../git/utils/gitBranchUpdateFeedback";
import type {
  GitRepositoryBatchResult,
  GitRepositoryBranchCoverage,
  GitRepositoryCommonBranchesResult,
} from "../../git/types/gitRepositoryActions";
import {
  buildGitRepositoryIconColorSlots,
  GIT_REPOSITORY_ICON_COLOR_CLASSES,
} from "../../git/utils/gitRepositoryIconColors";

const EMPTY_BRANCHES: BranchInfo[] = [];
const EMPTY_BRANCH_ITEMS: GitBranchListItem[] = [];
const EMPTY_REPOSITORIES: GitRepositorySummary[] = [];
const DEFAULT_EXPANDED_BRANCH_SECTIONS = {
  recent: true,
  local: false,
  remote: false,
};

/** 切换仓库时的最小 loading 时长，保证 loading 态可见、避免闪烁 */
const BRANCH_SWITCH_MIN_LOADING_MS = 120;

export type ComposerBranchControl = {
  branchName: string;
  branches: BranchInfo[];
  localBranches?: GitBranchListItem[];
  remoteBranches?: GitBranchListItem[];
  currentBranch?: string | null;
  repositories?: GitRepositorySummary[];
  repositoriesLoading?: boolean;
  repositoriesError?: string | null;
  selectedRepositoryRoot?: string | null;
  branchError?: string | null;
  onSelectRepository?: (repositoryRoot: string | null) => Promise<void> | void;
  onCheckout: (name: string) => Promise<void> | void;
  onCreate: (name: string) => Promise<void> | void;
  onUpdate?: (name: string) => Promise<GitBranchUpdateResult | null> | GitBranchUpdateResult | null;
  onUpdateAllRepositories?: () => Promise<GitRepositoryBatchResult | null>;
  onCheckoutAllRepositories?: (
    branchName: string,
    eligibleRepositoryRoots?: readonly string[],
  ) => Promise<GitRepositoryBatchResult | null>;
  onLoadCommonRepositoryBranches?: () => Promise<GitRepositoryCommonBranchesResult | null>;
  onCommit?: (repositoryRoot: string) => Promise<void> | void;
  onPush?: (repositoryRoot: string) => Promise<void> | void;
  /** worktree 工作区下禁用切换，仅展示当前分支 */
  disabled?: boolean;
};

function RepositoryStatus({ repository }: { repository: GitRepositorySummary }) {
  const statusItems = gitRepositoryStatusItems(repository);
  return (
    <span
      className="composer-git-repository-status"
      title={repository.error ?? repository.upstream ?? undefined}
      aria-hidden
    >
      {statusItems.map((item, index) => (
        <span
          key={`${item.label}:${index}`}
          className={`composer-git-repository-token is-${item.kind}`}
        >
          {item.label}
        </span>
      ))}
    </span>
  );
}

function BranchRow({
  branch,
  currentBranch,
  displayName = branch.name,
  onSelect,
}: {
  branch: GitBranchListItem;
  currentBranch: string | null;
  displayName?: string;
  onSelect: (name: string) => void;
}) {
  return (
    <CommandItem
      className="composer-git-branch-item"
      value={branch.name}
      onSelect={() => onSelect(branch.name)}
    >
      <GitBranch className="size-4 shrink-0 opacity-60" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{displayName}</span>
      <span className="composer-git-branch-meta" aria-hidden>
        {branch.ahead > 0 ? `↑${branch.ahead}` : ""}
        {branch.behind > 0 ? `↓${branch.behind}` : ""}
      </span>
      {branch.upstream ? (
        <span className="composer-git-upstream" title={branch.upstream}>
          {branch.upstream}
        </span>
      ) : null}
      {branch.isCurrent || branch.name === currentBranch ? (
        <CheckIcon className="size-4 shrink-0" aria-hidden />
      ) : null}
    </CommandItem>
  );
}

function GlobalBranchRow({
  branch,
  displayName = branch.name,
  totalRepositoryCount,
  disabled,
  onSelect,
}: {
  branch: GitRepositoryBranchCoverage;
  displayName?: string;
  totalRepositoryCount: number;
  disabled: boolean;
  onSelect: (branchName: string) => void;
}) {
  return (
    <CommandItem value={`${branch.name} ${branch.repositories.map(({ displayName: name }) => name).join(" ")}`} disabled={disabled} onSelect={() => onSelect(branch.name)}>
      <GitBranch className="size-4 shrink-0 opacity-60" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{displayName}</span>
      <span className="composer-git-upstream" title={branch.repositories.map(({ displayName: name }) => name).join(", ")}>
        {branch.repositories.map(({ displayName: name }) => name).join(", ")}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {branch.repositories.length}/{totalRepositoryCount}
      </span>
      <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden />
    </CommandItem>
  );
}

type BranchSectionProps = {
  id: "recent" | "local" | "remote";
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
};

type BranchScopeProps = {
  id: string;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
};

function BranchSection({ id, label, expanded, onToggle, children }: BranchSectionProps) {
  return (
    <CommandGroup>
      <button
        type="button"
        className="composer-git-section-toggle"
        aria-expanded={expanded}
        aria-controls={`composer-git-section-${id}`}
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        )}
        <span>{label}</span>
      </button>
      {expanded ? <div id={`composer-git-section-${id}`}>{children}</div> : null}
    </CommandGroup>
  );
}

function BranchScope({ id, label, expanded, onToggle, children }: BranchScopeProps) {
  return (
    <div className="composer-git-branch-scope-group">
      <button
        type="button"
        className="composer-git-branch-scope"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" aria-hidden />
        )}
        <span>{label}</span>
      </button>
      {expanded ? (
        <div id={id} className="composer-git-branch-scope-children">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ComposerBranchBadgeComponent({
  branchName,
  branches = EMPTY_BRANCHES,
  localBranches = EMPTY_BRANCH_ITEMS,
  remoteBranches = EMPTY_BRANCH_ITEMS,
  currentBranch = null,
  repositories = EMPTY_REPOSITORIES,
  repositoriesLoading = false,
  repositoriesError = null,
  selectedRepositoryRoot = null,
  branchError = null,
  onSelectRepository,
  onCheckout,
  onCreate,
  onUpdate,
  onUpdateAllRepositories,
  onCheckoutAllRepositories,
  onLoadCommonRepositoryBranches,
  onCommit,
  onPush,
  disabled = false,
}: ComposerBranchControl) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeRepositoryRoot, setActiveRepositoryRoot] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [switchingRepositoryRoot, setSwitchingRepositoryRoot] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    ...DEFAULT_EXPANDED_BRANCH_SECTIONS,
  });
  const [expandedScopes, setExpandedScopes] = useState<Set<string>>(() => new Set());
  const [updatePending, setUpdatePending] = useState(false);
  const [globalCheckoutMode, setGlobalCheckoutMode] = useState(false);
  const [commonBranchesLoading, setCommonBranchesLoading] = useState(false);
  const [commonBranches, setCommonBranches] = useState<GitRepositoryCommonBranchesResult | null>(null);
  const [globalActionPending, setGlobalActionPending] = useState<"update" | "checkout" | null>(null);
  const commonBranchesRequestRef = useRef(0);
  const [updateFeedback, setUpdateFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [globalActionFeedback, setGlobalActionFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const trimmedQuery = query.trim();
  const revealBranchSections = trimmedQuery.length > 0;
  const activeRepository = useMemo(
    () =>
      repositories.find(
        (repository) => repository.repositoryRoot === activeRepositoryRoot,
      ) ?? null,
    [activeRepositoryRoot, repositories],
  );
  const selectedRepository = useMemo(
    () =>
      repositories.find(
        (repository) => repository.repositoryRoot === selectedRepositoryRoot,
      ) ?? null,
    [repositories, selectedRepositoryRoot],
  );
  const repositoryIconColorSlots = useMemo(
    () => buildGitRepositoryIconColorSlots(repositories),
    [repositories],
  );
  const triggerBranchName =
    selectedRepository?.currentBranch ??
    (selectedRepository?.headState === "detached" ? "HEAD" : branchName);
  const effectiveCurrentBranch = currentBranch || triggerBranchName || null;
  const showRepositoryList = repositories.length > 1 && activeRepositoryRoot === null && !globalCheckoutMode;
  const showGlobalCheckout = repositories.length > 1 && activeRepositoryRoot === null && globalCheckoutMode;
  const effectiveRepositoryRoot =
    activeRepositoryRoot ?? selectedRepositoryRoot ?? repositories[0]?.repositoryRoot ?? "";
  const exactMatch = useMemo(
    () =>
      trimmedQuery
        ? branches.find((branch) => branch.name === trimmedQuery) ?? null
        : null,
    [branches, trimmedQuery],
  );
  const canCreate = trimmedQuery.length > 0 && !exactMatch;
  const recentBranches = useMemo(
    () => localBranches.slice().sort((a, b) => b.lastCommit - a.lastCommit).slice(0, 5),
    [localBranches],
  );
  const localGroups = useMemo(() => {
    const groups = new Map<string, GitBranchListItem[]>();
    localBranches.forEach((branch) => {
      const separatorIndex = branch.name.lastIndexOf("/");
      const scope = separatorIndex > 0 ? branch.name.slice(0, separatorIndex) : "";
      const group = groups.get(scope) ?? [];
      group.push(branch);
      groups.set(scope, group);
    });
    return Array.from(groups.entries());
  }, [localBranches]);
  const remoteGroups = useMemo(() => {
    const groups = new Map<string, { remote: string; scope: string; branches: GitBranchListItem[] }>();
    remoteBranches.forEach((branch) => {
      const remote = branch.remote || branch.name.split("/")[0] || "origin";
      const branchPath = branch.name.startsWith(`${remote}/`)
        ? branch.name.slice(remote.length + 1)
        : branch.name;
      const separatorIndex = branchPath.lastIndexOf("/");
      const scope = separatorIndex > 0 ? branchPath.slice(0, separatorIndex) : "";
      const key = `${remote}:${scope}`;
      const group = groups.get(key) ?? { remote, scope, branches: [] };
      group.branches.push(branch);
      groups.set(key, group);
    });
    return Array.from(groups.values());
  }, [remoteBranches]);
  const commonRemoteGroups = useMemo(() => {
    const groups = new Map<string, GitRepositoryBranchCoverage[]>();
    commonBranches?.remoteBranches.forEach((branch) => {
      const separatorIndex = branch.name.indexOf("/");
      const remote = separatorIndex > 0 ? branch.name.slice(0, separatorIndex) : "remote";
      const group = groups.get(remote) ?? [];
      group.push(branch);
      groups.set(remote, group);
    });
    return Array.from(groups.entries());
  }, [commonBranches]);

  const branchValidationMessage = useMemo(() => {
    if (!trimmedQuery) return null;
    if (trimmedQuery === "." || trimmedQuery === "..") return t("workspace.branchCannotBeDot");
    if (/\s/.test(trimmedQuery)) return t("workspace.branchCannotContainSpaces");
    if (trimmedQuery.startsWith("/") || trimmedQuery.endsWith("/")) return t("workspace.branchCannotStartEndSlash");
    if (trimmedQuery.endsWith(".lock")) return t("workspace.branchCannotEndLock");
    if (trimmedQuery.includes("..")) return t("workspace.branchCannotContainDotDot");
    if (trimmedQuery.includes("@{")) return t("workspace.branchCannotContainAtBrace");
    if (["~", "^", ":", "?", "*", "[", "\\"].some((char) => trimmedQuery.includes(char))) {
      return t("workspace.branchContainsInvalidChars");
    }
    return trimmedQuery.endsWith(".") ? t("workspace.branchCannotEndDot") : null;
  }, [trimmedQuery, t]);

  const closeMenu = useCallback(() => {
    commonBranchesRequestRef.current += 1;
    setMenuOpen(false);
    setActiveRepositoryRoot(null);
    setQuery("");
    setError(null);
    setUpdateFeedback(null);
    setGlobalCheckoutMode(false);
    setCommonBranchesLoading(false);
    setCommonBranches(null);
    setGlobalActionPending(null);
    setGlobalActionFeedback(null);
    setSwitchingRepositoryRoot(null);
    setExpandedSections({ ...DEFAULT_EXPANDED_BRANCH_SECTIONS });
    setExpandedScopes(new Set());
  }, []);

  const handleOpenGlobalCheckout = useCallback(async () => {
    if (!onLoadCommonRepositoryBranches || commonBranchesLoading || globalActionPending) return;
    const requestId = commonBranchesRequestRef.current + 1;
    commonBranchesRequestRef.current = requestId;
    setGlobalCheckoutMode(true);
    setCommonBranchesLoading(true);
    setCommonBranches(null);
    setQuery("");
    setGlobalActionFeedback(null);
    setExpandedSections((current) => ({ ...current, local: true, remote: true }));
    try {
      const result = await onLoadCommonRepositoryBranches();
      if (commonBranchesRequestRef.current !== requestId) return;
      setCommonBranches(result);
      setExpandedScopes(new Set(result?.remoteBranches.map((branch) => `global-remote:${branch.name.split("/")[0] ?? "remote"}`)));
    } catch (caughtError) {
      if (commonBranchesRequestRef.current !== requestId) return;
      setGlobalActionFeedback({
        tone: "error",
        message: caughtError instanceof Error ? caughtError.message : String(caughtError),
      });
    } finally {
      if (commonBranchesRequestRef.current === requestId) setCommonBranchesLoading(false);
    }
  }, [commonBranchesLoading, globalActionPending, onLoadCommonRepositoryBranches]);

  const handleBackFromGlobalCheckout = useCallback(() => {
    commonBranchesRequestRef.current += 1;
    setGlobalCheckoutMode(false);
    setCommonBranchesLoading(false);
    setCommonBranches(null);
    setQuery("");
    setGlobalActionFeedback(null);
  }, []);

  const handleSelectRepository = useCallback(
    async (repositoryRoot: string) => {
      if (switchingRepositoryRoot !== null) return;
      setError(null);
      setSwitchingRepositoryRoot(repositoryRoot);
      try {
        await Promise.all([
          Promise.resolve(onSelectRepository?.(repositoryRoot)),
          new Promise<void>((resolve) => window.setTimeout(resolve, BRANCH_SWITCH_MIN_LOADING_MS)),
        ]);
        setActiveRepositoryRoot(repositoryRoot);
        setQuery("");
        setExpandedSections({ ...DEFAULT_EXPANDED_BRANCH_SECTIONS });
        setExpandedScopes(new Set());
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      } finally {
        setSwitchingRepositoryRoot(null);
      }
    },
    [onSelectRepository, switchingRepositoryRoot],
  );

  const toggleSection = useCallback((section: keyof typeof expandedSections) => {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  }, []);

  const toggleScope = useCallback((scopeKey: string) => {
    setExpandedScopes((current) => {
      const next = new Set(current);
      if (next.has(scopeKey)) next.delete(scopeKey);
      else next.add(scopeKey);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    if (repositories.length <= 1) {
      const onlyRoot = repositories[0]?.repositoryRoot ?? selectedRepositoryRoot ?? "";
      setActiveRepositoryRoot(onlyRoot);
      onSelectRepository?.(onlyRoot);
    } else {
      // 仅在当前查看的仓库不再合法时才重置回仓库列表，
      // 避免 repositories 引用刷新（轮询/更新操作）把用户弹出分支视图。
      setActiveRepositoryRoot((prev) =>
        prev !== null && !repositories.some((repository) => repository.repositoryRoot === prev)
          ? null
          : prev,
      );
    }
  }, [menuOpen, onSelectRepository, repositories, selectedRepositoryRoot]);

  const runAction = useCallback(
    async (action: () => Promise<void> | void, closeAfter = true) => {
      try {
        await action();
        if (closeAfter) closeMenu();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      }
    },
    [closeMenu],
  );

  const handleUpdate = useCallback(async () => {
    if (!onUpdate || !effectiveCurrentBranch || updatePending) return;
    setError(null);
    setUpdateFeedback(null);
    setUpdatePending(true);
    try {
      const result = await onUpdate(effectiveCurrentBranch);
      if (!result) return;
      setUpdateFeedback(getGitBranchUpdateFeedback(t, result, effectiveCurrentBranch));
    } catch (caughtError) {
      setUpdateFeedback({
        tone: "error",
        message: caughtError instanceof Error ? caughtError.message : String(caughtError),
      });
    } finally {
      setUpdatePending(false);
    }
  }, [effectiveCurrentBranch, onUpdate, t, updatePending]);

  const applyGlobalActionResult = useCallback((result: GitRepositoryBatchResult | null) => {
    if (!result) return;
    const failedCount = result.failedRepositories.length;
    const skippedCount = result.skippedRepositories.length;
    const summary = t("git.repositoryBatchSummary", {
      success: result.successCount,
      failed: failedCount,
      skipped: skippedCount,
    });
    const failedDetails = failedCount > 0
      ? ` ${t("git.repositoryBatchFailedRepositories", {
          repositories: result.failedRepositories.join(", "),
        })}`
      : "";
    setGlobalActionFeedback({
      tone: failedCount > 0 ? "error" : "success",
      message: `${summary}${failedDetails}`,
    });
  }, [t]);

  const handleUpdateAll = useCallback(async () => {
    if (!onUpdateAllRepositories || globalActionPending) return;
    setGlobalActionFeedback(null);
    setGlobalActionPending("update");
    try {
      applyGlobalActionResult(await onUpdateAllRepositories());
    } catch (caughtError) {
      setGlobalActionFeedback({
        tone: "error",
        message: caughtError instanceof Error ? caughtError.message : String(caughtError),
      });
    } finally {
      setGlobalActionPending(null);
    }
  }, [applyGlobalActionResult, globalActionPending, onUpdateAllRepositories]);

  const handleCheckoutAll = useCallback(async (
    branchName: string,
    eligibleRepositoryRoots: readonly string[],
  ) => {
    if (!onCheckoutAllRepositories || !branchName || globalActionPending) return;
    setGlobalActionFeedback(null);
    setGlobalActionPending("checkout");
    try {
      applyGlobalActionResult(await onCheckoutAllRepositories(branchName, eligibleRepositoryRoots));
    } catch (caughtError) {
      setGlobalActionFeedback({
        tone: "error",
        message: caughtError instanceof Error ? caughtError.message : String(caughtError),
      });
    } finally {
      setGlobalActionPending(null);
    }
  }, [applyGlobalActionResult, globalActionPending, onCheckoutAllRepositories]);

  if (disabled) {
    return (
      <div className="composer-branch-badge">
        <button type="button" className="composer-branch-badge-trigger" disabled title={triggerBranchName}>
          <GitBranch size={13} aria-hidden className="composer-branch-badge-icon" />
          <span className="composer-branch-badge-name">{triggerBranchName}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="composer-branch-badge">
      <Popover open={menuOpen} onOpenChange={(next) => (next ? setMenuOpen(true) : closeMenu())}>
        <PopoverTrigger asChild>
          <button type="button" className="composer-branch-badge-trigger" aria-haspopup="menu" aria-expanded={menuOpen} title={triggerBranchName}>
            <GitBranch size={13} aria-hidden className="composer-branch-badge-icon" />
            <span className="composer-branch-badge-name">{triggerBranchName}</span>
            <ChevronDown size={12} aria-hidden className="composer-branch-badge-caret" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" sideOffset={6} className="composer-git-command-center w-[32rem] max-w-[calc(100vw-2rem)] p-0">
          <Command>
            <div className="composer-git-command-header">
              <CommandInput value={query} onValueChange={(value) => { setQuery(value); setError(null); setGlobalActionFeedback(null); }} placeholder={showGlobalCheckout ? t("workspace.searchBranches") : showRepositoryList ? t("git.switchRepository") : t("workspace.searchOrCreateBranch")} autoFocus aria-label={showGlobalCheckout ? t("workspace.searchBranches") : showRepositoryList ? t("git.switchRepository") : t("workspace.searchBranches")} />
              {showRepositoryList ? (
                <div className="composer-git-header-actions" role="group" aria-label={t("git.sectionActions", { title: t("git.switchRepository") })}>
                  {onUpdateAllRepositories ? (
                    <TooltipIconButton
                      label={t("git.repositoryBatchUpdateAll")}
                      className="composer-git-header-action"
                      disabled={globalActionPending !== null}
                      onClick={() => void handleUpdateAll()}
                    >
                      {globalActionPending === "update" ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw className="size-4" aria-hidden />
                      )}
                    </TooltipIconButton>
                  ) : null}
                  {onCheckoutAllRepositories && onLoadCommonRepositoryBranches ? (
                    <TooltipIconButton
                      label={t("git.repositoryBatchCheckoutAll")}
                      className="composer-git-header-action"
                      disabled={globalActionPending !== null}
                      onClick={() => void handleOpenGlobalCheckout()}
                    >
                      <GitBranch className="size-4" aria-hidden />
                    </TooltipIconButton>
                  ) : null}
                </div>
              ) : !showGlobalCheckout ? (
                <div className="composer-git-header-actions" role="group" aria-label={t("git.sectionActions", { title: triggerBranchName })}>
                  {onUpdate && effectiveCurrentBranch ? (
                    <TooltipIconButton
                      label={t("git.historyBranchMenuUpdate")}
                      className="composer-git-header-action"
                      disabled={updatePending}
                      onClick={() => void handleUpdate()}
                    >
                      {updatePending ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw className="size-4" aria-hidden />
                      )}
                    </TooltipIconButton>
                  ) : null}
                  {onCommit ? (
                    <TooltipIconButton
                      label={t("git.commit")}
                      className="composer-git-header-action"
                      onClick={() => void runAction(() => onCommit(effectiveRepositoryRoot))}
                    >
                      <GitCommitHorizontal className="size-4" aria-hidden />
                    </TooltipIconButton>
                  ) : null}
                  {onPush ? (
                    <TooltipIconButton
                      label={t("git.push")}
                      className="composer-git-header-action"
                      onClick={() => void runAction(() => onPush(effectiveRepositoryRoot))}
                    >
                      <Upload className="size-4" aria-hidden />
                    </TooltipIconButton>
                  ) : null}
                </div>
              ) : null}
            </div>
            <CommandList>
              <CommandEmpty>{repositoriesLoading ? t("git.scanningRepositories") : t("workspace.noBranchesFound")}</CommandEmpty>
              {showGlobalCheckout ? (
                <>
                  <CommandGroup>
                    <CommandItem value="__back_global_actions" disabled={globalActionPending !== null} onSelect={handleBackFromGlobalCheckout}>
                      <ArrowLeft className="size-4" aria-hidden />
                      <span>{t("workspace.back")}</span>
                    </CommandItem>
                  </CommandGroup>
                  {commonBranchesLoading ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground" role="status">
                      <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      <span>{t("git.repositoryBatchLoadingBranches")}</span>
                    </div>
                  ) : (
                    <>
                      {commonBranches?.failedRepositories.length ? (
                        <div className="px-4 py-3 text-sm text-destructive" role="alert">
                          <span>{t("git.repositoryBatchBranchesLoadFailed")}</span>{" "}
                          <span>{commonBranches.failedRepositories.join(", ")}</span>
                        </div>
                      ) : null}
                      {commonBranches?.localBranches.length ? (
                        <BranchSection id="local" label={t("git.repositoryBatchCommonLocalBranches")} expanded={revealBranchSections || expandedSections.local} onToggle={() => toggleSection("local")}>
                          {commonBranches.localBranches.map((branch) => (
                            <GlobalBranchRow key={`global-local:${branch.name}`} branch={branch} totalRepositoryCount={commonBranches.totalRepositoryCount} disabled={globalActionPending !== null} onSelect={(name) => void handleCheckoutAll(name, branch.repositories.map(({ repositoryRoot }) => repositoryRoot))} />
                          ))}
                        </BranchSection>
                      ) : null}
                      {commonRemoteGroups.length ? (
                        <BranchSection id="remote" label={t("git.repositoryBatchCommonRemoteBranches")} expanded={revealBranchSections || expandedSections.remote} onToggle={() => toggleSection("remote")}>
                          {commonRemoteGroups.map(([remote, branches]) => (
                            <BranchScope key={`global-remote:${remote}`} id={`composer-global-remote-${remote}`} label={remote} expanded={revealBranchSections || expandedScopes.has(`global-remote:${remote}`)} onToggle={() => toggleScope(`global-remote:${remote}`)}>
                              {branches.map((branch) => (
                                <GlobalBranchRow key={`global-remote:${branch.name}`} branch={branch} displayName={branch.name.startsWith(`${remote}/`) ? branch.name.slice(remote.length + 1) : branch.name} totalRepositoryCount={commonBranches?.totalRepositoryCount ?? repositories.length} disabled={globalActionPending !== null} onSelect={(name) => void handleCheckoutAll(name, branch.repositories.map(({ repositoryRoot }) => repositoryRoot))} />
                              ))}
                            </BranchScope>
                          ))}
                        </BranchSection>
                      ) : null}
                      {commonBranches && commonBranches.localBranches.length === 0 && commonBranches.remoteBranches.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-muted-foreground" role="status">{t("git.repositoryBatchNoCommonBranches")}</div>
                      ) : null}
                    </>
                  )}
                </>
              ) : showRepositoryList ? (
                <>
                  <CommandGroup>
                    {repositories.map((repository) => (
                    <CommandItem
                      key={repository.repositoryRoot || "__root__"}
                      value={`${repository.displayName} ${repository.repositoryRoot}`}
                      disabled={switchingRepositoryRoot !== null || globalActionPending !== null}
                      onSelect={() => void handleSelectRepository(repository.repositoryRoot)}
                    >
                      {switchingRepositoryRoot === repository.repositoryRoot ? (
                        <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />
                      ) : (
                        <FolderGit2
                          className={`size-4 shrink-0 ${GIT_REPOSITORY_ICON_COLOR_CLASSES[repositoryIconColorSlots.get(repository.repositoryRoot) ?? 0]}`}
                          data-repository-color-slot={repositoryIconColorSlots.get(repository.repositoryRoot) ?? 0}
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{repository.displayName}</span>
                      <RepositoryStatus repository={repository} />
                      {switchingRepositoryRoot !== repository.repositoryRoot ? (
                        <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden />
                      ) : null}
                    </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              ) : (
                <>
                  {repositories.length > 1 ? (
                    <CommandGroup>
                      <CommandItem value="__back_repositories" onSelect={() => { setActiveRepositoryRoot(null); setQuery(""); onSelectRepository?.(null); }}>
                        <ArrowLeft className="size-4" aria-hidden />
                        <span>{t("workspace.back")}</span>
                        {activeRepository ? <span className="ml-auto truncate text-muted-foreground">{activeRepository.displayName}</span> : null}
                      </CommandItem>
                    </CommandGroup>
                  ) : null}
                  {recentBranches.length > 0 ? (
                    <BranchSection
                      id="recent"
                      label={t("git.repositoryRecentBranches")}
                      expanded={revealBranchSections || expandedSections.recent}
                      onToggle={() => toggleSection("recent")}
                    >
                      {recentBranches.map((branch) => <BranchRow key={`recent:${branch.name}`} branch={branch} currentBranch={effectiveCurrentBranch} onSelect={(name) => void runAction(() => onCheckout(name))} />)}
                    </BranchSection>
                  ) : null}
                  {localGroups.length > 0 ? (
                    <BranchSection
                      id="local"
                      label={t("git.repositoryLocalBranches")}
                      expanded={revealBranchSections || expandedSections.local}
                      onToggle={() => toggleSection("local")}
                    >
                      {localGroups.map(([scope, localItems]) => (
                        <div key={`local:${scope || "root"}`}>
                          {scope ? (
                            <BranchScope
                              id={`composer-git-local-scope-${encodeURIComponent(scope)}`}
                              label={scope}
                              expanded={revealBranchSections || expandedScopes.has(`local:${scope}`)}
                              onToggle={() => toggleScope(`local:${scope}`)}
                            >
                              {localItems.map((branch) => <BranchRow key={`local:${branch.name}`} branch={branch} displayName={branch.name.slice(scope.length + 1)} currentBranch={effectiveCurrentBranch} onSelect={(name) => void runAction(() => onCheckout(name))} />)}
                            </BranchScope>
                          ) : localItems.map((branch) => <BranchRow key={`local:${branch.name}`} branch={branch} displayName={branch.name} currentBranch={effectiveCurrentBranch} onSelect={(name) => void runAction(() => onCheckout(name))} />)}
                        </div>
                      ))}
                    </BranchSection>
                  ) : null}
                  {remoteGroups.length > 0 ? (
                    <BranchSection
                      id="remote"
                      label={t("git.repositoryRemoteBranches")}
                      expanded={revealBranchSections || expandedSections.remote}
                      onToggle={() => toggleSection("remote")}
                    >
                      {remoteGroups.map(({ remote, scope, branches: remoteItems }) => (
                        <div key={`${remote}:${scope}`}>
                          <BranchScope
                            id={`composer-git-remote-scope-${encodeURIComponent(`${remote}:${scope}`)}`}
                            label={`${remote}${scope ? ` / ${scope}` : ""}`}
                            expanded={revealBranchSections || expandedScopes.has(`remote:${remote}:${scope}`)}
                            onToggle={() => toggleScope(`remote:${remote}:${scope}`)}
                          >
                            {remoteItems.map((branch) => <BranchRow key={`remote:${branch.name}`} branch={branch} displayName={branch.name.split("/").at(-1) ?? branch.name} currentBranch={effectiveCurrentBranch} onSelect={(name) => void runAction(() => onCheckout(name))} />)}
                          </BranchScope>
                        </div>
                      ))}
                    </BranchSection>
                  ) : null}
                  {canCreate && !branchValidationMessage ? (
                    <CommandGroup>
                      <CommandItem value={trimmedQuery} onSelect={() => void runAction(() => onCreate(trimmedQuery))}>
                        <PlusIcon className="size-4 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{t("workspace.createBranchNamed", { name: trimmedQuery })}</span>
                      </CommandItem>
                    </CommandGroup>
                  ) : null}
                </>
              )}
            </CommandList>
            {globalActionFeedback || updateFeedback || branchValidationMessage || error || branchError || repositoriesError ? (
              <div
                className={`px-3 py-2 text-xs ${(globalActionFeedback ?? updateFeedback)?.tone === "success" ? "text-emerald-600" : "text-destructive"}`}
                role={(globalActionFeedback ?? updateFeedback)?.tone === "error" || branchValidationMessage || error || branchError || repositoriesError ? "alert" : "status"}
              >
                {globalActionFeedback?.message || updateFeedback?.message || branchValidationMessage || error || branchError || repositoriesError}
              </div>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export const ComposerBranchBadge = memo(ComposerBranchBadgeComponent);
