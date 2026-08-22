import { beforeEach, describe, expect, it } from "vitest";
import {
  getClientStoreSync,
  resetClientStorageForTests,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import type { QueuedMessage } from "../../../types";
import {
  readSharedQueuedFollowUps,
  writeSharedQueuedFollowUps,
} from "./sharedQueuedFollowUpStore";

const TARGET = {
  engine: "codex" as const,
  providerProfileId: "provider-1",
  modelCatalogEntryId: "catalog-1",
  model: "gpt-5.6-sol",
  reasoning: { effort: "max" },
  providerProfileNameSnapshot: "OpenAI",
  providerProfileSource: "managed" as const,
};

describe("sharedQueuedFollowUpStore", () => {
  beforeEach(() => {
    resetClientStorageForTests();
  });

  it("round-trips the frozen Shared envelope", () => {
    const item: QueuedMessage = {
      id: "queued-1",
      text: "继续检查",
      createdAt: 42,
      images: ["local://image"],
      sendOptions: { effort: "max" },
      sharedExecutionTarget: TARGET,
      sharedPredecessorAttemptId: "attempt-1",
      ownerWorkspaceId: "workspace-1",
      ownerThreadId: "shared:thread-1",
    };

    writeSharedQueuedFollowUps("workspace-1", "shared:thread-1", [item]);

    expect(readSharedQueuedFollowUps("workspace-1", "shared:thread-1")).toEqual(
      [item],
    );
    expect(
      getClientStoreSync("composer", "sharedQueuedFollowUps.v1"),
    ).toBeTruthy();
  });

  it("fails closed for a persisted item without a resolved target", () => {
    writeClientStoreValue(
      "composer",
      "sharedQueuedFollowUps.v1",
      {
        [JSON.stringify(["workspace-1", "shared:thread-1"])]: [
          {
            id: "queued-1",
            text: "不要回退 Picker",
            createdAt: 42,
            sharedExecutionTarget: {
              engine: "codex",
              model: "gpt-5.6-sol",
            },
          },
        ],
      },
      { immediate: true },
    );

    expect(readSharedQueuedFollowUps("workspace-1", "shared:thread-1")).toEqual(
      [],
    );
  });

  it("does not restore an options-level Target beside the frozen envelope", () => {
    const item: QueuedMessage = {
      id: "queued-1",
      text: "只允许 envelope owner",
      createdAt: 42,
      sendOptions: {
        sharedExecutionTarget: {
          ...TARGET,
          providerProfileId: "provider-stale",
        },
      },
      sharedExecutionTarget: TARGET,
      sharedPredecessorAttemptId: "attempt-1",
    };

    writeSharedQueuedFollowUps("workspace-1", "shared:thread-1", [item]);

    expect(
      readSharedQueuedFollowUps("workspace-1", "shared:thread-1")[0]
        ?.sendOptions,
    ).not.toHaveProperty("sharedExecutionTarget");
  });
});
