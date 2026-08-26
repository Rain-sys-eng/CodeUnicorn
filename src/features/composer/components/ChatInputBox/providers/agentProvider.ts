import type { DropdownItemData } from "../types";
import i18n from "../../../i18n/config";
import {
  listAgentConfigs,
  listBuiltInAgents,
} from "../../../../../services/tauri";
import type { BuiltInAgentDivision } from "../../../../../types";
import { BUILT_IN_AGENT_CATALOG_CHANGED_EVENT } from "../../../../agent-catalog/events";
import {
  getAgentIconRenderValue,
  resolveAgentIconForAgent,
} from "../../../../../utils/agentIcons";
import { debugError, debugLog, debugWarn } from "../../../utils/debug.js";

export interface AgentItem {
  id: string;
  name: string;
  prompt?: string;
  icon?: string;
  description?: string;
  source?: "custom" | "builtIn";
  divisionId?: string;
  divisionLabel?: string;
  sourceRevision?: string;
  promptHash?: string;
  sectionCount?: number;
  itemKind?: "agent" | "sectionHeader";
}

type LoadingState = "idle" | "loading" | "success" | "failed";

const MIN_REFRESH_INTERVAL = 1000;
const LOADING_TIMEOUT = 4000;

// Module-level mutable cache: intentional singleton state shared across all
// consumers.  This avoids redundant Tauri IPC round-trips when multiple
// components request the agent list within the same refresh window.
let cachedCustomAgents: AgentItem[] = [];
let cachedBuiltInAgents: AgentItem[] = [];
let cachedBuiltInDivisions: BuiltInAgentDivision[] = [];
let loadingState: LoadingState = "idle";
let lastRefreshTime = 0;
let inflightLoad: Promise<void> | null = null;
let catalogChangeListenerInstalled = false;
let catalogGeneration = 0;

function ensureCatalogChangeListener() {
  if (catalogChangeListenerInstalled || typeof window === "undefined") {
    return;
  }
  window.addEventListener(BUILT_IN_AGENT_CATALOG_CHANGED_EVENT, resetAgentsState);
  catalogChangeListenerInstalled = true;
}

function normalizeAgents(items: AgentItem[]): AgentItem[] {
  return items
    .map((item) => ({
      id: String(item.id ?? "").trim(),
      name: String(item.name ?? "").trim(),
      prompt: item.prompt?.trim() || undefined,
      description: item.description?.trim() || undefined,
      icon: resolveAgentIconForAgent(item, "codicon-robot"),
      source: item.source ?? "custom",
      divisionId: item.divisionId?.trim() || undefined,
      divisionLabel: item.divisionLabel?.trim() || undefined,
      sourceRevision: item.sourceRevision?.trim() || undefined,
      promptHash: item.promptHash?.trim() || undefined,
      itemKind: item.itemKind ?? "agent",
    }))
    .filter((item) => item.id.length > 0 && item.name.length > 0);
}

async function refreshAgents(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastRefreshTime < MIN_REFRESH_INTERVAL) {
    return;
  }
  if (inflightLoad) {
    return inflightLoad;
  }

  loadingState = "loading";
  lastRefreshTime = now;
  const loadGeneration = catalogGeneration;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

  const currentLoad = (async () => {
    try {
      const [agents, builtInCatalog] = await Promise.race([
        Promise.all([
          listAgentConfigs(),
          listBuiltInAgents(i18n.resolvedLanguage ?? i18n.language),
        ]),
        new Promise<never>((_, reject) => {
          timeoutId = globalThis.setTimeout(() => {
            reject(new Error("Agent list loading timeout"));
          }, LOADING_TIMEOUT);
        }),
      ]);
      if (loadGeneration !== catalogGeneration) {
        return;
      }
      cachedCustomAgents = normalizeAgents(
        (agents ?? []).map((agent) => ({
          id: agent.id,
          name: agent.name,
          prompt: agent.prompt ?? undefined,
          icon: agent.icon ?? undefined,
          source: "custom",
        })),
      );
      const divisionById = new Map(
        builtInCatalog.divisions.map((division) => [division.id, division]),
      );
      cachedBuiltInDivisions = builtInCatalog.divisions;
      cachedBuiltInAgents = normalizeAgents(
        builtInCatalog.agents
          .filter((agent) => agent.enabled)
          .map((agent) => ({
            id: agent.id,
            name: agent.name,
            description: agent.description,
            source: "builtIn",
            divisionId: agent.divisionId,
            divisionLabel: divisionById.get(agent.divisionId)?.label,
            sourceRevision: agent.sourceRevision,
            promptHash: agent.promptHash,
          })),
      );
      loadingState = "success";
      debugLog(
        `[AgentProvider] Loaded ${cachedCustomAgents.length} custom and ${cachedBuiltInAgents.length} enabled built-in agents`,
      );
    } catch (error) {
      if (loadGeneration === catalogGeneration) {
        loadingState = "failed";
        debugWarn("[AgentProvider] Failed to load agents");
        debugError("[AgentProvider] Load error:", error);
      }
    } finally {
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      if (loadGeneration === catalogGeneration) {
        inflightLoad = null;
      }
    }
  })();
  inflightLoad = currentLoad;

  return currentLoad;
}

function filterAgents(agents: AgentItem[], query: string): AgentItem[] {
  if (!query.trim()) {
    return agents;
  }
  const lower = query.trim().toLowerCase();
  return agents.filter(
    (agent) =>
      agent.name.toLowerCase().includes(lower) ||
      agent.prompt?.toLowerCase().includes(lower) ||
      agent.description?.toLowerCase().includes(lower) ||
      agent.divisionLabel?.toLowerCase().includes(lower),
  );
}

function sectionHeader(
  id: string,
  name: string,
  sectionCount: number,
  icon: string,
): AgentItem {
  return {
    id: `__section__:${id}`,
    name,
    icon,
    sectionCount,
    itemKind: "sectionHeader",
  };
}

function buildGroupedAgents(): AgentItem[] {
  const items: AgentItem[] = [];
  if (cachedCustomAgents.length > 0) {
    items.push(
      sectionHeader(
        "custom",
        i18n.t("settings.agent.myAgents"),
        cachedCustomAgents.length,
        "codicon-account",
      ),
    );
    items.push(...cachedCustomAgents);
  }
  for (const division of cachedBuiltInDivisions) {
    const divisionAgents = cachedBuiltInAgents.filter(
      (agent) => agent.divisionId === division.id,
    );
    if (divisionAgents.length === 0) {
      continue;
    }
    items.push(
      sectionHeader(
        `division:${division.id}`,
        division.label,
        divisionAgents.length,
        "codicon-symbol-namespace",
      ),
    );
    items.push(...divisionAgents);
  }
  return items;
}

export const CREATE_NEW_AGENT_ID = "__create_new__";
export const EMPTY_STATE_ID = "__empty_state__";

export function resetAgentsState() {
  catalogGeneration += 1;
  cachedCustomAgents = [];
  cachedBuiltInAgents = [];
  cachedBuiltInDivisions = [];
  loadingState = "idle";
  lastRefreshTime = 0;
  inflightLoad = null;
}

/** @deprecated No-op retained for backward compatibility; will be removed. */
export function setupAgentsCallback() {
  return;
}

export function forceRefreshAgents() {
  void refreshAgents(true);
}

export async function agentProvider(
  query: string,
  signal: AbortSignal,
): Promise<AgentItem[]> {
  ensureCatalogChangeListener();
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  if (loadingState === "idle" || loadingState === "failed") {
    await refreshAgents();
  } else if (loadingState === "loading") {
    await (inflightLoad ?? Promise.resolve());
  } else if (Date.now() - lastRefreshTime >= MIN_REFRESH_INTERVAL) {
    await refreshAgents();
  }

  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const createItem: AgentItem = {
    id: CREATE_NEW_AGENT_ID,
    name: i18n.t("settings.agent.createAgent"),
    prompt: "",
  };

  const allAgents = [...cachedCustomAgents, ...cachedBuiltInAgents];
  const filtered = query.trim()
    ? filterAgents(allAgents, query)
    : buildGroupedAgents();
  if (filtered.length === 0) {
    return [
      {
        id: EMPTY_STATE_ID,
        name:
          loadingState === "failed"
            ? i18n.t("settings.agent.loadFailed")
            : i18n.t("settings.agent.noAgentsDropdown"),
        prompt: "",
      },
      createItem,
    ];
  }

  return [...filtered, createItem];
}

export function agentToDropdownItem(agent: AgentItem): DropdownItemData {
  if (agent.itemKind === "sectionHeader") {
    return {
      id: agent.id,
      label: agent.name,
      type: "section-header",
      icon: agent.icon,
      data: {
        agent,
        sectionCount: agent.sectionCount,
      },
    };
  }
  if (agent.id === EMPTY_STATE_ID || agent.id === "__loading__" || agent.id === "__empty__") {
    return {
      id: agent.id,
      label: agent.name,
      description: agent.prompt,
      icon: "codicon-info",
      type: "info",
      data: { agent },
    };
  }

  if (agent.id === CREATE_NEW_AGENT_ID) {
    return {
      id: agent.id,
      label: agent.name,
      description: i18n.t("settings.agent.createAgentHint"),
      icon: "codicon-add",
      type: "agent",
      data: { agent },
    };
  }

  return {
    id: agent.id,
    label: agent.name,
    description:
      agent.source === "builtIn"
        ? [agent.divisionLabel, agent.description].filter(Boolean).join(" · ")
        : agent.prompt
          ? agent.prompt.length > 60
            ? `${agent.prompt.slice(0, 60)}...`
            : agent.prompt
          : undefined,
    icon: getAgentIconRenderValue(
      agent.icon,
      agent.id || agent.name,
      "codicon-robot",
    ),
    type: "agent",
    data: {
      agent,
      scopeLabel: agent.source === "builtIn" ? agent.divisionLabel : undefined,
    },
  };
}
