// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "../../../types";
import { ApprovalToasts } from "./ApprovalToasts";

describe("ApprovalToasts", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders directory grant card with scope options and sends scope on accept", () => {
    const onDecision = vi.fn();
    const approvals: ApprovalRequest[] = [
      {
        workspace_id: "ws-1",
        request_id: "req-grant-1",
        method: "item/directoryGrant/requestApproval",
        params: {
          threadId: "claude:thread-1",
          suggestedRoot: "/Users/me/.claude",
          grantKind: "directory",
          defaultScope: "session",
          isSensitiveRoot: true,
          message: "Path is outside allowed working directories",
        },
      },
    ];

    render(
      <ApprovalToasts
        approvals={approvals}
        workspaces={[{ id: "ws-1", name: "demo", path: "/tmp/demo" } as never]}
        onDecision={onDecision}
        variant="inline"
      />,
    );

    expect(screen.getByText("approval.directoryGrant")).toBeTruthy();
    expect(screen.getByText("/Users/me/.claude")).toBeTruthy();
    expect(screen.getByText("approval.grantSensitiveHint")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("approval.grantScopeWorkspace"));
    fireEvent.click(screen.getByRole("button", { name: "approval.approveEnter" }));

    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: "req-grant-1",
        params: expect.objectContaining({ scope: "workspace" }),
      }),
      "accept",
    );
  });

  it("shows batch approve action when approvals share the same thread without turn id", () => {
    const approvals: ApprovalRequest[] = [
      {
        workspace_id: "ws-1",
        request_id: "req-1",
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "claude:thread-1",
          file_path: "aaa.txt",
        },
      },
      {
        workspace_id: "ws-1",
        request_id: "req-2",
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "claude:thread-1",
          file_path: "bbb.txt",
        },
      },
    ];
    const onApproveBatch = vi.fn();

    render(
      <ApprovalToasts
        approvals={approvals}
        workspaces={[]}
        onDecision={vi.fn()}
        onApproveBatch={onApproveBatch}
        variant="inline"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "approval.approveTurnBatch" }));
    expect(onApproveBatch).toHaveBeenCalledWith(approvals);
  });

  it("falls back to workspace file batch in inline mode when thread ids are missing", () => {
    const approvals: ApprovalRequest[] = [
      {
        workspace_id: "ws-1",
        request_id: "req-1",
        method: "item/fileChange/requestApproval",
        params: {
          toolName: "Write",
          input: { file_path: "aaa.txt" },
        },
      },
      {
        workspace_id: "ws-1",
        request_id: "req-2",
        method: "item/fileChange/requestApproval",
        params: {
          toolName: "Write",
          input: { file_path: "bbb.txt" },
        },
      },
    ];
    const onApproveBatch = vi.fn();

    render(
      <ApprovalToasts
        approvals={approvals}
        workspaces={[]}
        onDecision={vi.fn()}
        onApproveBatch={onApproveBatch}
        variant="inline"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "approval.approveTurnBatch" }));
    expect(onApproveBatch).toHaveBeenCalledWith(approvals);
  });

  it("does not show batch approve action when the latest approval is not a file change", () => {
    render(
      <ApprovalToasts
        approvals={[
          {
            workspace_id: "ws-1",
            request_id: "req-1",
            method: "item/fileChange/requestApproval",
            params: {
              toolName: "Write",
              input: { file_path: "aaa.txt" },
            },
          },
          {
            workspace_id: "ws-1",
            request_id: "req-2",
            method: "item/commandExecution/requestApproval",
            params: {
              toolName: "ShellCommand",
              command: ["pwd"],
            },
          },
        ]}
        workspaces={[]}
        onDecision={vi.fn()}
        onApproveBatch={vi.fn()}
        variant="inline"
      />,
    );

    expect(screen.queryByRole("button", { name: "approval.approveTurnBatch" })).toBeNull();
  });

  it("hides large file content fields from approval detail view", () => {
    const { container } = render(
      <ApprovalToasts
        approvals={[
          {
            workspace_id: "ws-1",
            request_id: "req-1",
            method: "item/fileChange/requestApproval",
            params: {
              toolName: "Write",
              file_path: "/repo/.env.example",
              content: "SECRET=demo",
              new_string: "NEXT=demo",
              message: "Approve to continue",
            },
          },
        ]}
        workspaces={[]}
        onDecision={vi.fn()}
        variant="inline"
      />,
    );

    expect(screen.getByText("approval.filePathLabel")).toBeTruthy();
    expect(screen.getByText("/repo/.env.example")).toBeTruthy();
    expect(screen.getByText("approval.toolLabel")).toBeTruthy();
    expect(screen.getByText("Write")).toBeTruthy();
    expect(container.querySelector(".approval-toast-icon-wrap")).toBeTruthy();
    expect(container.querySelector(".approval-toast-summary-band")).toBeTruthy();
    expect(container.querySelector(".approval-toast-badge")).toBeTruthy();
    expect(screen.queryByText("Content")).toBeNull();
    expect(screen.queryByText("New string")).toBeNull();
    expect(screen.queryByText("SECRET=demo")).toBeNull();
    expect(screen.queryByText("NEXT=demo")).toBeNull();
  });

  it("reads file path and tool name from nested input payloads", () => {
    render(
      <ApprovalToasts
        approvals={[
          {
            workspace_id: "ws-1",
            request_id: "req-nested-1",
            method: "item/fileChange/requestApproval",
            params: {
              toolName: "Write",
              input: {
                file_path: "/repo/nested/demo.txt",
                tool_name: "NestedWrite",
              },
            },
          },
        ]}
        workspaces={[]}
        onDecision={vi.fn()}
        variant="inline"
      />,
    );

    expect(screen.getByText("/repo/nested/demo.txt")).toBeTruthy();
    expect(screen.getByText("Write")).toBeTruthy();
  });

  it("keeps DSH request identifiers collapsed until the user expands them", () => {
    render(
      <ApprovalToasts
        approvals={[
          {
            workspace_id: "ws-1",
            request_id: "req-dsh-1",
            method: "item/commandExecution/requestApproval",
            params: {
              toolName: "bash",
              message:
                "escalate sandbox to danger-full-access: Write a one-line probe file outside the workspace so the ask-mode approval popup can be demonstrated.",
              approvalId: "6d2363ce-65a9-4248-be84-437547f479a8",
              callId: "call-8dc2bd6e-6e50-457a-8ad4-0deb9f2efa27-5:code:2",
              reason:
                "escalate sandbox to danger-full-access: Write a one-line probe file outside the workspace so the ask-mode approval popup can be demonstrated.",
              sessionId: "session-de20d28d-12c3-4488-a427-7ad06b59310f",
              type: "approval/requested",
              rpcId: "rpc-approval-1",
              method: "events.mux",
            },
          },
        ]}
        workspaces={[]}
        onDecision={vi.fn()}
        variant="inline"
      />,
    );

    expect(
      screen.getByText(/escalate sandbox to danger-full-access/),
    ).toBeTruthy();
    expect(screen.queryByText("6d2363ce-65a9-4248-be84-437547f479a8")).toBeNull();
    expect(
      screen.queryByText("session-de20d28d-12c3-4488-a427-7ad06b59310f"),
    ).toBeNull();
    expect(screen.queryByText("approval/requested")).toBeNull();
    expect(screen.queryByText("call-8dc2bd6e-6e50-457a-8ad4-0deb9f2efa27-5:code:2")).toBeNull();
    expect(screen.queryByText("rpc-approval-1")).toBeNull();
    expect(screen.queryByText("events.mux")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /approval.showDebugDetails|Show request details/i }),
    );
    expect(screen.getByText("6d2363ce-65a9-4248-be84-437547f479a8")).toBeTruthy();
    expect(
      screen.getByText("session-de20d28d-12c3-4488-a427-7ad06b59310f"),
    ).toBeTruthy();
    expect(screen.getByText("approval/requested")).toBeTruthy();
    expect(
      screen.getByText("call-8dc2bd6e-6e50-457a-8ad4-0deb9f2efa27-5:code:2"),
    ).toBeTruthy();
    expect(screen.getByText("rpc-approval-1")).toBeTruthy();
    expect(screen.getByText("events.mux")).toBeTruthy();
  });

  it("offers a close button that dismisses the current approval card locally", () => {
    const onDecision = vi.fn();

    render(
      <ApprovalToasts
        approvals={[
          {
            workspace_id: "ws-1",
            request_id: "req-close-1",
            method: "item/fileChange/requestApproval",
            params: {
              file_path: "/repo/demo.txt",
            },
          },
        ]}
        workspaces={[]}
        onDecision={onDecision}
        variant="inline"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "approval.close" }));
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: "req-close-1" }),
      "dismiss",
    );
  });
});
