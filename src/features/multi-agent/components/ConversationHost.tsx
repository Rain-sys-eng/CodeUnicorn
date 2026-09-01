import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AgentBridgeConversationSurface } from "../../agent-bridge";
import {
  shallowEqual,
  useActiveCanvasSelector,
} from "../../layout/hooks/activeCanvasStore";
import {
  closeSubagentInspector,
  closeSubagentInspectorIfScopeChanged,
  ConversationInspectorSplit,
  SubagentInspectorDrawer,
  useSubagentInspectorSelection,
} from "../../subagent-ui";
import { isTerminalAgentStatus } from "../types";
import {
  closeAgentInspector,
  closeAgentInspectorIfScopeChanged,
  openAgentInspector,
  useAgentInspectorSelection,
} from "../store/inspectorStore";
import { useAgentProjection, useAgentRoundList } from "../store/agentStore";
import { AgentInspectorDrawer } from "./AgentInspectorDrawer";
import { MultiAgentConversationSurface } from "./ConversationSurface";

type MultiAgentConversationHostProps = {
  messagesNode: ReactNode;
  composerNode: ReactNode | null;
  workspaceId?: string | null;
  workspacePath?: string | null;
};

const EMPTY_NATIVE_THREAD_IDS: readonly string[] = [];

/**
 * 聊天列宿主：
 * - Multi-Agent 活跃时优先左右分屏展示协作 Inspector（直播），不被原生子代理抢走。
 * - 无 Multi-Agent 时保留 engine-native SubAgent inspector。
 */
export function MultiAgentConversationHost({
  messagesNode,
  composerNode,
  workspaceId = null,
  workspacePath = null,
}: MultiAgentConversationHostProps) {
  const { t } = useTranslation();
  const parentScope = useActiveCanvasSelector(
    (state) => ({
      threadId: state.threadId,
      workspaceId: state.workspaceId,
      activeNativeThreadIds: state.activeNativeThreadIds,
    }),
    shallowEqual,
  );
  const agentWorkspaceId = parentScope.workspaceId ?? workspaceId;
  const subagentWorkspaceId = workspaceId ?? parentScope.workspaceId;
  const projection = useAgentProjection(
    agentWorkspaceId,
    parentScope.threadId,
  );
  const rounds = useAgentRoundList(agentWorkspaceId, parentScope.threadId);
  const agentSelection = useAgentInspectorSelection();
  const subagentSelection = useSubagentInspectorSelection();

  useEffect(() => {
    closeAgentInspectorIfScopeChanged(
      agentWorkspaceId,
      parentScope.threadId,
    );
    closeSubagentInspectorIfScopeChanged(
      subagentWorkspaceId,
      parentScope.threadId,
    );
  }, [agentWorkspaceId, parentScope.threadId, subagentWorkspaceId]);

  // 仅在「新 runId 出现」时自动开右栏一次；用户手动关闭后不因 status 变化反复强开
  useEffect(() => {
    if (!projection || !agentWorkspaceId || !parentScope.threadId) {
      return;
    }
    if (!parentScope.threadId.startsWith("shared:")) {
      return;
    }
    if (isTerminalAgentStatus(projection.status)) {
      return;
    }
    const latestRoundIndex = Math.max(0, rounds.length - 1);
    openAgentInspector({
      workspaceId: agentWorkspaceId,
      threadId: parentScope.threadId,
      runId: projection.runId,
      roundIndex: latestRoundIndex,
    });
    // 故意只依赖 runId：status 切换（planning→awaiting）不应再次抢开右栏
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-once-per-run
  }, [agentWorkspaceId, parentScope.threadId, projection?.runId]);

  const agentActive =
    Boolean(projection) &&
    !isTerminalAgentStatus(projection!.status);
  // 右栏：进行中优先；终态也可手动打开回看
  const agentOpen =
    Boolean(agentSelection) &&
    rounds.length > 0 &&
    agentSelection!.workspaceId === agentWorkspaceId &&
    agentSelection!.threadId === parentScope.threadId;
  // Multi-Agent 活跃时压制原生子代理分屏，避免「规划中变成子代理网格」。
  const subagentOpen = !agentActive && Boolean(subagentSelection);
  const open = agentOpen || subagentOpen;

  return (
    <ConversationInspectorSplit
      messagesNode={messagesNode}
      conversationSurface={
        <>
          <MultiAgentConversationSurface
            workspaceId={agentWorkspaceId}
            threadId={parentScope.threadId}
          />
          <AgentBridgeConversationSurface
            workspaceId={agentWorkspaceId}
            threadId={parentScope.threadId}
            nativeThreadIds={
              parentScope.activeNativeThreadIds ?? EMPTY_NATIVE_THREAD_IDS
            }
          />
        </>
      }
      composerNode={composerNode}
      open={open}
      inspectorNode={
        agentOpen ? (
          <AgentInspectorDrawer />
        ) : subagentOpen ? (
          <SubagentInspectorDrawer
            workspaceId={subagentWorkspaceId}
            workspacePath={workspacePath}
          />
        ) : null
      }
      resizeLabel={
        agentOpen
          ? t("multiAgent.inspector.resize")
          : t("subagentUi.resizeSplit", {
              defaultValue: "调整子代理面板宽度",
            })
      }
      onRequestClose={
        agentOpen ? closeAgentInspector : closeSubagentInspector
      }
    />
  );
}
