import { describe, expect, it } from "vitest";
import {
  laneChipLabel,
  projectPiSessionTree,
} from "./piSessionTreeProjection";
import type { PiSessionTree, PiTreeNode } from "../api/piSessionRpc";

function node(
  id: string,
  parentId: string | null,
  role: string | null,
  text: string,
  children: PiTreeNode[] = [],
  label: string | null = null,
): PiTreeNode {
  return {
    entry: { id, parentId, type: "message", role, text },
    label,
    children,
  };
}

describe("projectPiSessionTree", () => {
  it("线性会话 = 单 lane，active lane 为 0", () => {
    const tree: PiSessionTree = {
      nodes: [node("a1", null, "user", "hi", [node("a2", "a1", "assistant", "ok")])],
      leafId: "a2",
      derivedLanes: [],
      rootSessionId: null,
      rootEntries: [],
    };
    const projection = projectPiSessionTree(tree);
    expect(projection.laneCount).toBe(1);
    expect(projection.activeLane).toBe(0);
    expect(projection.nodes.map((n) => n.entryId)).toEqual(["a1", "a2"]);
    expect(projection.nodes.every((n) => n.onActivePath)).toBe(true);
  });

  it("主线贯穿分叉点：首个 child 延续 lane 0，其余开新 lane", () => {
    // a1 → a2 → (b1 lane0 延续 | c1 lane1)，leaf 在 c2
    const tree: PiSessionTree = {
      nodes: [
        node("a1", null, "user", "root", [
          node("a2", "a1", "assistant", "scan", [
            node("b1", "a2", "user", "方向一", [
              node("b2", "b1", "assistant", "失败"),
            ]),
            node("c1", "a2", "user", "方向二", [
              node("c2", "c1", "assistant", "成功"),
            ]),
          ]),
        ]),
      ],
      leafId: "c2",
      derivedLanes: [],
      rootSessionId: null,
      rootEntries: [],
    };
    const projection = projectPiSessionTree(tree);
    expect(projection.laneCount).toBe(2);
    expect(projection.activeLane).toBe(1);
    const byId = new Map(projection.nodes.map((n) => [n.entryId, n]));
    expect(byId.get("b1")?.lane).toBe(0); // 首个 child 延续主线
    expect(byId.get("b2")?.lane).toBe(0);
    expect(byId.get("c1")?.lane).toBe(1);
    expect(byId.get("c2")?.lane).toBe(1);
    expect(byId.get("c2")?.onActivePath).toBe(true);
    expect(byId.get("b2")?.onActivePath).toBe(false);
    expect(byId.get("c2")?.isLeaf).toBe(true);
    expect(byId.get("a1")?.isLeaf).toBe(false);
  });

  it("label 书签透传", () => {
    const tree: PiSessionTree = {
      nodes: [node("a1", null, "user", "hi", [], "bookmark-1")],
      leafId: "a1",
      derivedLanes: [],
      rootSessionId: null,
      rootEntries: [],
    };
    const projection = projectPiSessionTree(tree);
    expect(projection.nodes[0]?.label).toBe("bookmark-1");
  });
});


describe("graftDerivedLanes via projectPiSessionTree", () => {
  it("fork 派生 lane 去重共享前缀并接在分叉点", () => {
    const tree: PiSessionTree = {
      nodes: [node("a1", null, "user", "root", [node("a2", "a1", "assistant", "ok")])],
      leafId: "a2",
      derivedLanes: [
        {
          sessionId: "fork-1",
          sessionFile: "/tmp/fork.jsonl",
          entries: [
            { id: "a1", parentId: null, type: "message", role: "user", text: "root" },
            { id: "b1", parentId: "a1", type: "message", role: "user", text: "换个方向" },
            { id: "b2", parentId: "b1", type: "message", role: "assistant", text: "好" },
          ],
        },
      ],
      rootSessionId: null,
      rootEntries: [],
    };
    const projection = projectPiSessionTree(tree);
    // 首个 child（源文件延续）留 lane 0，派生 graft 尾部开 lane 1
    expect(projection.laneCount).toBe(2);
    const byId = new Map(projection.nodes.map((n) => [n.entryId, n]));
    expect(byId.get("a2")?.lane).toBe(0);
    expect(byId.get("b1")?.lane).toBe(1);
    expect(byId.get("b2")?.lane).toBe(1);
    expect(byId.get("a1")?.lane).toBe(0);
    // 共享前缀不重复出现
    expect(projection.nodes.filter((n) => n.entryId === "a1")).toHaveLength(1);
    // 激活路径仍是源会话 leaf
    expect(byId.get("b1")?.onActivePath).toBe(false);
  });
});


describe("会话族全图（跳入分支后主线不截断）", () => {
  it("rootEntries 提供主线 + 派生 lane + lane0 可跳回主线", () => {
    const tree: PiSessionTree = {
      // 当前文件是派生分支：RPC tree 是分支自己的子树，但 rootEntries（主线）
      // MUST 优先作为基底，否则主线整体丢失
      nodes: [
        node("b1", "a1", "user", "分支", [
          node("b2", "b1", "assistant", "好"),
        ]),
      ],
      leafId: "b2",
      derivedLanes: [
        {
          sessionId: "branch-1",
          sessionFile: "/tmp/branch.jsonl",
          entries: [
            { id: "a1", parentId: null, type: "message", role: "user", text: "root" },
            { id: "b1", parentId: "a1", type: "message", role: "user", text: "分支" },
            { id: "b2", parentId: "b1", type: "message", role: "assistant", text: "好" },
          ],
        },
      ],
      rootSessionId: "root-session",
      rootEntries: [
        { id: "a1", parentId: null, type: "message", role: "user", text: "root" },
        { id: "a2", parentId: "a1", type: "message", role: "assistant", text: "主线继续" },
      ],
    };
    const projection = projectPiSessionTree(tree);
    const byId = new Map(projection.nodes.map((n) => [n.entryId, n]));
    // 主线贯穿：a1 → a2 都在 lane 0
    expect(byId.get("a1")?.lane).toBe(0);
    expect(byId.get("a2")?.lane).toBe(0);
    // 派生 lane 从分叉点长出
    expect(byId.get("b1")?.lane).toBe(1);
    expect(byId.get("b2")?.lane).toBe(1);
    // lane 0 可跳回主线；派生 lane 可跳分支
    expect(projection.laneSessionIds[0]).toBe("root-session");
    expect(projection.laneSessionIds[1]).toBe("branch-1");
    // 当前 leaf 在分支 lane
    expect(projection.activeLane).toBe(1);
    // 共享前缀 id 不重复
    expect(projection.nodes.filter((n) => n.entryId === "a1")).toHaveLength(1);
  });
});

describe("laneChipLabel", () => {
  it("lane 0 = main，其余 b<N>", () => {
    expect(laneChipLabel(0)).toBe("main");
    expect(laneChipLabel(2)).toBe("b2");
  });
});
