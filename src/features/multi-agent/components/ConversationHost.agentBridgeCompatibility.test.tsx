/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../agent-bridge", () => ({
  AgentBridgeConversationSurface: () => <div>agent-bridge-surface</div>,
}));

vi.mock("../../layout/hooks/activeCanvasStore", () => ({
  shallowEqual: Object.is,
  useActiveCanvasSelector: (
    selector: (state: Record<string, unknown>) => unknown,
  ) =>
    selector({
      threadId: "claude:source",
      workspaceId: "workspace-1",
      activeNativeThreadIds: [],
    }),
}));

vi.mock("../../subagent-ui", () => ({
  closeSubagentInspector: vi.fn(),
  closeSubagentInspectorIfScopeChanged: vi.fn(),
  ConversationInspectorSplit: ({
    messagesNode,
    conversationSurface,
    composerNode,
  }: {
    messagesNode: ReactNode;
    conversationSurface: ReactNode;
    composerNode: ReactNode;
  }) => (
    <div>
      {messagesNode}
      {conversationSurface}
      {composerNode}
    </div>
  ),
  SubagentInspectorDrawer: () => null,
  useSubagentInspectorSelection: () => null,
}));

vi.mock("../store/inspectorStore", () => ({
  closeAgentInspector: vi.fn(),
  closeAgentInspectorIfScopeChanged: vi.fn(),
  openAgentInspector: vi.fn(),
  useAgentInspectorSelection: () => null,
}));

vi.mock("../store/agentStore", () => ({
  useAgentProjection: () => null,
  useAgentRoundList: () => [],
}));

vi.mock("./AgentInspectorDrawer", () => ({
  AgentInspectorDrawer: () => null,
}));

vi.mock("./ConversationSurface", () => ({
  MultiAgentConversationSurface: () => <div>multi-agent-v1-surface</div>,
}));

import { MultiAgentConversationHost } from "./ConversationHost";

describe("MultiAgentConversationHost Agent Bridge compatibility", () => {
  it("keeps the existing conversation and Multi-Agent V1 surface mounted", () => {
    render(
      <MultiAgentConversationHost
        messagesNode={<div>single-agent-messages</div>}
        composerNode={<div>single-agent-composer</div>}
        workspaceId="workspace-1"
      />,
    );

    expect(screen.getByText("single-agent-messages")).toBeTruthy();
    expect(screen.getByText("single-agent-composer")).toBeTruthy();
    expect(screen.getByText("multi-agent-v1-surface")).toBeTruthy();
    expect(screen.getByText("agent-bridge-surface")).toBeTruthy();
  });
});
