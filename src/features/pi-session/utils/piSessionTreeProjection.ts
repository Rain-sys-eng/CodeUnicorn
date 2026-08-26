import type {
  PiDerivedLaneEntry,
  PiSessionTree,
  PiTreeNode,
} from "../api/piSessionRpc";

/** Flat disk-parsed entries（root / derived file）→ nested forest。 */
function entriesToForest(entries: PiDerivedLaneEntry[]): PiTreeNode[] {
  const byId = new Map<string, PiTreeNode>();
  const roots: PiTreeNode[] = [];
  for (const entry of entries) {
    byId.set(entry.id, {
      entry: {
        id: entry.id,
        parentId: entry.parentId,
        type: entry.type,
        timestamp: entry.timestamp,
        role: entry.role,
        text: entry.text,
      },
      label: null,
      children: [],
    });
  }
  byId.forEach((node) => {
    const parent = node.entry.parentId ? byId.get(node.entry.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

/**
 * Graft fork-derived lanes onto the source forest: derived files copy the
 * source prefix with the SAME entry ids, so shared-prefix entries dedupe by
 * id and only the divergence tail attaches under its parentId (which lives
 * in the source tree or an earlier derived entry). Each derived file
 * naturally becomes a new lane at its fork point.
 */
export function graftDerivedLanes(
  tree: PiSessionTree,
  originByEntryId?: Map<string, string>,
): PiTreeNode[] {
  if (tree.derivedLanes.length === 0) {
    return tree.nodes;
  }
  const byId = new Map<string, PiTreeNode>();
  const register = (node: PiTreeNode) => {
    byId.set(node.entry.id, node);
    node.children.forEach(register);
  };
  tree.nodes.forEach(register);

  for (const lane of tree.derivedLanes) {
    for (const entry of lane.entries) {
      if (byId.has(entry.id)) {
        continue; // shared prefix copied from the source file
      }
      originByEntryId?.set(entry.id, lane.sessionId);
      const node: PiTreeNode = {
        entry: {
          id: entry.id,
          parentId: entry.parentId,
          type: entry.type,
          timestamp: entry.timestamp,
          role: entry.role,
          text: entry.text,
        },
        label: null,
        children: [],
      };
      byId.set(entry.id, node);
      const parent = entry.parentId ? byId.get(entry.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      }
      // parent 缺失（断链）时作为 orphan 不挂载——不造出假根。
    }
  }
  return tree.nodes;
}

/**
 * Lane projection for the PI session tree.
 *
 * Lane 0 is the root path ("main"); a single child continues the current
 * lane, and at a multi-child fork the FIRST child (the in-file continuation)
 * keeps the lane while the rest open new lanes — the main line runs through
 * fork points unbroken, branches grow sideways.
 */

export type PiLaneNode = {
  entryId: string;
  parentId: string | null;
  lane: number;
  /** fork 派生 lane 的源 session id（该 lane 是独立文件）；源会话节点为 null */
  originSessionId: string | null;
  role: string | null;
  text: string;
  label: string | null;
  timestamp: string | null;
  isLeaf: boolean;
  onActivePath: boolean;
};

export type PiLaneProjection = {
  nodes: PiLaneNode[];
  laneCount: number;
  activeLane: number;
  leafId: string | null;
  /** lane → 可跳转的派生 session id（lane 0 / 文件内 lane 无映射） */
  laneSessionIds: Record<number, string>;
};

function flattenWithLanes(
  node: PiTreeNode,
  lane: number,
  nextLaneRef: { value: number },
  out: PiLaneNode[],
  pathIds: Set<string>,
  originByEntryId: Map<string, string>,
): void {
  out.push({
    entryId: node.entry.id,
    parentId: node.entry.parentId,
    originSessionId: originByEntryId.get(node.entry.id) ?? null,
    lane,
    role: node.entry.role,
    text: node.entry.text,
    label: node.label,
    timestamp: node.entry.timestamp ?? null,
    isLeaf: false,
    onActivePath: pathIds.has(node.entry.id),
  });
  node.children.forEach((child, index) => {
    // 主线延续语义：单 child 延续当前 lane；多 child 分叉点首个 child
    // （原文件内的延续）留在当前 lane，其余 child 各开新 lane——主线
    // 贯穿分叉点不断裂，分支从旁路长出（2026-08-23 用户验收口径）。
    const childLane =
      node.children.length === 1 || index === 0 ? lane : nextLaneRef.value++;
    flattenWithLanes(child, childLane, nextLaneRef, out, pathIds, originByEntryId);
  });
}

function activePathIds(tree: PiSessionTree): Set<string> {
  const ids = new Set<string>();
  if (!tree.leafId) {
    return ids;
  }
  const byId = new Map<string, PiTreeNode>();
  const walk = (node: PiTreeNode) => {
    byId.set(node.entry.id, node);
    node.children.forEach(walk);
  };
  tree.nodes.forEach(walk);
  let current = byId.get(tree.leafId);
  while (current) {
    ids.add(current.entry.id);
    const parentId = current.entry.parentId;
    current = parentId ? byId.get(parentId) : undefined;
  }
  return ids;
}

export function projectPiSessionTree(tree: PiSessionTree): PiLaneProjection {
  const originByEntryId = new Map<string, string>();
  // 会话族全图：rootEntries（主线，磁盘解析）存在时 MUST 优先作为基底——
  // 当前文件是分支时 RPC tree 只是分支自己的子树，若采用它主线会整体
  // 丢失（「跳入分支后看不到主线」的 bug）；当前分支内容已在 derivedLanes
  // 里，graft 会 dedupe 拼接。rootEntries 为空（当前即 root）才用 RPC tree
  // （带 labels 的更富形态）。
  const baseNodes =
    tree.rootEntries.length > 0 ? entriesToForest(tree.rootEntries) : tree.nodes;
  const graftedNodes = graftDerivedLanes(
    { ...tree, nodes: baseNodes },
    originByEntryId,
  );
  const graftedTree: PiSessionTree = { ...tree, nodes: graftedNodes };
  const pathIds = activePathIds(graftedTree);
  const out: PiLaneNode[] = [];
  const nextLaneRef = { value: 1 };
  graftedNodes.forEach((root, index) => {
    // A well-formed session has a single root; orphans appear as extra roots
    // and get their own lanes.
    const rootLane = index === 0 ? 0 : nextLaneRef.value++;
    flattenWithLanes(root, rootLane, nextLaneRef, out, pathIds, originByEntryId);
  });
  const childCount = new Map<string, number>();
  out.forEach((node) => {
    if (node.parentId) {
      childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
    }
  });
  out.forEach((node) => {
    node.isLeaf = !childCount.has(node.entryId);
  });
  const laneCount = new Set(out.map((node) => node.lane)).size;
  const activeLane = tree.leafId
    ? (out.find((node) => node.entryId === tree.leafId)?.lane ?? 0)
    : 0;
  const laneSessionIds: Record<number, string> = {};
  out.forEach((node) => {
    if (node.originSessionId && laneSessionIds[node.lane] === undefined) {
      laneSessionIds[node.lane] = node.originSessionId;
    }
  });
  // lane 0 = root 主线：从分支里也能跳回主线（来回跳转）。
  if (tree.rootSessionId) {
    laneSessionIds[0] = tree.rootSessionId;
  }
  return {
    nodes: out,
    laneCount,
    activeLane,
    leafId: tree.leafId,
    laneSessionIds,
  };
}

/** Short lane name for the tab chip: `main` for lane 0, `b<N>` otherwise. */
export function laneChipLabel(lane: number): string {
  return lane === 0 ? "main" : `b${lane}`;
}
