import {
  compactProjectCanvasFiles,
  readProjectCanvasFile,
  trashProjectCanvasFile,
  writeProjectCanvasFile,
} from "../../../services/tauri";
import type {
  CanvasAiAnnotation,
  CanvasCodeSymbolKind,
  CanvasEvidenceRef,
  IntentCanvasCodeSelectionAnchor,
  CanvasSemanticGraph,
  CanvasSemanticEdge,
  CanvasSemanticNode,
  CanvasSourceAnchor,
  IntentCanvasDocument,
  IntentCanvasIndexEntry,
  IntentCanvasIndexFile,
  IntentCanvasLinks,
  IntentCanvasLoadResult,
  IntentCanvasMode,
  IntentCanvasOpenRequest,
  IntentCanvasScene,
  IntentCanvasWorkspaceRef,
} from "../types";
import { asString, asStringArray, isRecord } from "../utils/json";
import { normalizePathSeparators } from "../../../utils/path";
import {
  buildIntentCanvasAiContext,
  createInitialIntentCanvasScene,
  sanitizeIntentCanvasScene,
} from "../utils/scene";

export const INTENT_CANVAS_INDEX_PATH = "index.json";
const CANVAS_ID_PATTERN = /^canvas-[A-Za-z0-9._-]+$/;

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFileError(error: unknown): boolean {
  const message = normalizeErrorMessage(error).toLowerCase();
  return message.includes("not found") || message.includes("no such file") || message.includes("does not exist");
}

function createCanvasId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `canvas-${crypto.randomUUID()}`;
  }
  return `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values.flatMap((value) => {
        if (typeof value !== "string") {
          return [];
        }
        const normalized = value.trim();
        return normalized ? [normalized] : [];
      }),
    ),
  );
}

function collectSeedProjectMapNodeIds(seedSemanticGraphs: CanvasSemanticGraph[]): string[] {
  const nodeIds = new Set<string>();
  seedSemanticGraphs.forEach((graph) => {
    graph.nodes.forEach((node) => {
      if (node.sourceAnchor?.kind === "relationship-node") {
        nodeIds.add(node.sourceAnchor.nodeId);
      }
    });
  });
  return Array.from(nodeIds);
}

function collectSeedFilePaths(seedSemanticGraphs: CanvasSemanticGraph[]): string[] {
  const filePaths = new Set<string>();
  seedSemanticGraphs.forEach((graph) => {
    if (graph.sourceSelection?.filePath) {
      filePaths.add(graph.sourceSelection.filePath);
    }
    graph.nodes.forEach((node) => {
      if (node.sourceAnchor?.kind === "code-symbol" || node.sourceAnchor?.kind === "relationship-node") {
        if (node.sourceAnchor.filePath) {
          filePaths.add(node.sourceAnchor.filePath);
        }
      }
    });
  });
  return Array.from(filePaths);
}

function collectSeedSemanticGraphs(seedSemanticGraphs: CanvasSemanticGraph[] | undefined): CanvasSemanticGraph[] {
  return (seedSemanticGraphs ?? []).map(cloneCanvasGraph);
}

function normalizeCanvasId(value: unknown): string | null {
  const canvasId = asString(value);
  if (!canvasId || !CANVAS_ID_PATTERN.test(canvasId)) {
    return null;
  }
  if (
    canvasId.includes("..") ||
    canvasId.includes("/") ||
    canvasId.includes("\\") ||
    canvasId.includes(":")
  ) {
    return null;
  }
  return canvasId;
}

function resolveDocumentPath(canvasId: string): string {
  const safeCanvasId = normalizeCanvasId(canvasId);
  if (!safeCanvasId) {
    throw new Error(`Invalid Intent Canvas id: ${canvasId}`);
  }
  return `${safeCanvasId}.intent-canvas.json`;
}

function normalizeMode(value: unknown): IntentCanvasMode {
  return value === "spotlight" || value === "file" ? value : "architect";
}

function normalizeLinks(value: unknown): IntentCanvasLinks {
  if (!isRecord(value)) {
    return { projectMapNodeIds: [], filePaths: [], threadIds: [] };
  }
  return {
    projectMapNodeIds: asStringArray(value.projectMapNodeIds),
    filePaths: asStringArray(value.filePaths),
    threadIds: asStringArray(value.threadIds),
  };
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeFiniteNumber(value: unknown, minimum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  return normalized >= minimum ? normalized : null;
}

function normalizePathValue(value: unknown): string | null {
  const path = asString(value);
  if (!path) {
    return null;
  }
  return normalizePathSeparators(path);
}

function normalizeCanvasSourceRange(value: unknown): { startLine: number; startColumn?: number | null; endLine?: number | null; endColumn?: number | null } | null {
  if (!isRecord(value)) {
    return null;
  }
  const startLine = normalizeFiniteNumber(value.startLine, 1);
  const startColumn = normalizeFiniteNumber(value.startColumn, 0);
  const endLine = normalizeFiniteNumber(value.endLine, 1);
  const endColumn = normalizeFiniteNumber(value.endColumn, 0);
  if (startLine === null && endLine === null) {
    return null;
  }
  return {
    startLine: startLine ?? endLine ?? 1,
    startColumn: startColumn,
    endLine: endLine ?? startLine ?? 1,
    endColumn: endColumn,
  };
}

function normalizePositiveLineNumber(value: unknown): number | null {
  const line = typeof value === "number" ? Math.trunc(value) : Number.NaN;
  return Number.isFinite(line) && line >= 1 ? line : null;
}

function normalizeIntentCanvasCodeSelectionAnchor(value: unknown): IntentCanvasCodeSelectionAnchor | null {
  if (!isRecord(value)) {
    return null;
  }
  const source = asString(value.source);
  const filePath = asString(value.filePath);
  const startLine = normalizePositiveLineNumber(value.startLine);
  const endLine = normalizePositiveLineNumber(value.endLine);
  const declarationLine = normalizePositiveLineNumber(value.declarationLine);
  const symbolName = asString(value.symbolName);
  const symbolKind = asString(value.symbolKind);
  if (
    source !== "active-editor-selection" ||
    !filePath ||
    !startLine ||
    !endLine ||
    !declarationLine ||
    !symbolName ||
    !symbolKind
  ) {
    return null;
  }
  const normalizedStartLine = Math.min(startLine, endLine);
  const normalizedEndLine = Math.max(startLine, endLine);
  return {
    source,
    filePath,
    startLine: normalizedStartLine,
    endLine: normalizedEndLine,
    declarationLine,
    symbolName,
    symbolKind: [
      "class",
      "method",
      "function",
      "property",
      "interface",
      "enum",
      "record",
      "type",
      "struct",
      "trait",
    ].includes(symbolKind)
      ? symbolKind as IntentCanvasCodeSelectionAnchor["symbolKind"]
      : "property",
  };
}

function normalizeCanvasSourceAnchor(value: unknown): CanvasSourceAnchor | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = asString(value.kind);
  const workspaceId = asString(value.workspaceId);
  if (!workspaceId || !kind) {
    return null;
  }
  if (kind === "code-symbol") {
    const filePath = normalizePathValue(value.filePath);
    const symbolName = asString(value.symbolName);
    const symbolKind = asString(value.symbolKind);
    if (!filePath || !symbolName) {
      return null;
    }
    const resolvedSymbolKind: CanvasCodeSymbolKind =
      symbolKind === "function" || symbolKind === "method" || symbolKind === "class" || symbolKind === "module"
        ? symbolKind
        : "unknown";
    return {
      kind,
      workspaceId,
      filePath,
      symbolName,
      symbolKind: resolvedSymbolKind,
      scanRunId: asString(value.scanRunId),
      symbolId: asString(value.symbolId),
      selectionRange: normalizeCanvasSourceRange(value.selectionRange),
      definitionRange: normalizeCanvasSourceRange(value.definitionRange),
      resolvedBy: asString(value.resolvedBy) ?? undefined,
    };
  }
  if (kind === "relationship-node") {
    const nodeId = asString(value.nodeId);
    const nodeKind = asString(value.nodeKind);
    const scanRunId = asString(value.scanRunId);
    if (!nodeId || !nodeKind || !scanRunId) {
      return null;
    }
    return {
      kind,
      workspaceId,
      scanRunId,
      nodeId,
      nodeKind,
      filePath: normalizePathValue(value.filePath),
      symbolId: asString(value.symbolId),
    };
  }
  if (kind === "relationship-edge") {
    const edgeId = asString(value.edgeId);
    const relationKind = asString(value.relationKind);
    const sourceNodeId = asString(value.sourceNodeId);
    const targetNodeId = asString(value.targetNodeId);
    const scanRunId = asString(value.scanRunId);
    if (!edgeId || !relationKind || !sourceNodeId || !targetNodeId || !scanRunId) {
      return null;
    }
    return {
      kind,
      workspaceId,
      scanRunId,
      edgeId,
      relationKind,
      sourceNodeId,
      targetNodeId,
      evidenceIds: asStringArray(value.evidenceIds),
    };
  }
  return null;
}

function normalizeCanvasSemanticGraph(value: unknown): CanvasSemanticGraph | null {
  if (!isRecord(value)) {
    return null;
  }
  const graphId = asString(value.graphId);
  const createdAt = asString(value.createdAt);
  if (!graphId || !createdAt) {
    return null;
  }
  const nodes = Array.isArray(value.nodes)
    ? value.nodes.flatMap((node) => {
      const normalized = normalizeCanvasSemanticNode(node);
      return normalized ? [normalized] : [];
    })
    : [];
  const edges = Array.isArray(value.edges)
    ? value.edges.flatMap((edge) => {
      const normalized = normalizeCanvasSemanticEdge(edge);
      return normalized ? [normalized] : [];
    })
    : [];
  const sourceSnapshot = isRecord(value.sourceSnapshot) && value.sourceSnapshot.kind === "project-map-relations"
    ? {
        kind: "project-map-relations" as const,
        scanRunId: asString(value.sourceSnapshot.scanRunId),
        snapshotVersion: asString(value.sourceSnapshot.snapshotVersion),
      }
    : null;

  const importOptions = isRecord(value.importOptions)
    ? {
        depth: normalizeFiniteNumber(value.importOptions.depth, 0),
        direction: asString(value.importOptions.direction) as
          | "callers"
          | "callees"
          | "both"
          | "neighborhood"
          | undefined,
        centerNodeId: asString(value.importOptions.centerNodeId),
        maxNodes: normalizeFiniteNumber(value.importOptions.maxNodes, 0),
        maxEdges: normalizeFiniteNumber(value.importOptions.maxEdges, 0),
        omittedNodes: normalizeFiniteNumber(value.importOptions.omittedNodes, 0),
        omittedEdges: normalizeFiniteNumber(value.importOptions.omittedEdges, 0),
      }
    : undefined;

  return {
    graphId,
    createdAt,
    sourceSnapshot: sourceSnapshot && sourceSnapshot.scanRunId ? {
      kind: sourceSnapshot.kind,
      scanRunId: sourceSnapshot.scanRunId,
      snapshotVersion: sourceSnapshot.snapshotVersion,
    } : undefined,
    sourceSelection: normalizeIntentCanvasCodeSelectionAnchor(value.sourceSelection) ?? undefined,
    nodes,
    edges,
    importOptions,
  };
}

function normalizeCanvasSemanticNode(value: unknown): {
  id: string;
  label: string;
  kind: "file" | "symbol" | "module" | "group" | "endpoint" | "unknown";
  sourceAnchor?: CanvasSourceAnchor | null;
  evidenceIds?: string[];
  summary?: string | null;
  stale?: boolean;
  unresolved?: boolean;
} | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asString(value.id);
  const rawLabel = asString(value.label);
  const rawKind = asString(value.kind);
  if (!id || !rawLabel) {
    return null;
  }
  const kind =
    rawKind === "file" || rawKind === "symbol" || rawKind === "module" || rawKind === "group" || rawKind === "endpoint"
      ? rawKind
      : "unknown";
  return {
    id,
    label: rawLabel,
    kind,
    sourceAnchor: isRecord(value.sourceAnchor) ? normalizeCanvasSourceAnchor(value.sourceAnchor) : undefined,
    evidenceIds: asStringArray(value.evidenceIds),
    summary: asString(value.summary),
    stale: asBoolean(value.stale) ?? false,
    unresolved: asBoolean(value.unresolved) ?? false,
  };
}

function normalizeCanvasEvidenceRef(value: unknown): CanvasEvidenceRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asString(value.id);
  if (!id) {
    return null;
  }
  return {
    id,
    path: normalizePathValue(value.path),
    line: normalizeFiniteNumber(value.line, 1),
    excerpt: asString(value.excerpt),
    label: asString(value.label),
  };
}

function normalizeCanvasSemanticEdge(value: unknown): {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationKind: string;
  direction?: "out" | "in" | "both" | "undirected";
  sourceAnchor?: CanvasSourceAnchor | null;
  label?: string | null;
  evidenceIds?: string[];
  evidenceRefs?: CanvasEvidenceRef[];
  evidenceSummary?: string[];
  stale?: boolean;
  unresolved?: boolean;
} | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asString(value.id);
  const sourceNodeId = asString(value.sourceNodeId);
  const targetNodeId = asString(value.targetNodeId);
  const relationKind = asString(value.relationKind);
  if (!id || !sourceNodeId || !targetNodeId || !relationKind) {
    return null;
  }
  const direction = asString(value.direction);
  return {
    id,
    sourceNodeId,
    targetNodeId,
    relationKind,
    direction:
      direction === "out" || direction === "in" || direction === "both" || direction === "undirected"
        ? direction
        : undefined,
    sourceAnchor: isRecord(value.sourceAnchor) ? normalizeCanvasSourceAnchor(value.sourceAnchor) : undefined,
    label: asString(value.label),
    evidenceIds: asStringArray(value.evidenceIds),
    evidenceRefs: Array.isArray(value.evidenceRefs)
      ? value.evidenceRefs.flatMap((entry) => {
          const normalized = normalizeCanvasEvidenceRef(entry);
          return normalized ? [normalized] : [];
        })
      : undefined,
    evidenceSummary: asStringArray(value.evidenceSummary),
    stale: asBoolean(value.stale) ?? false,
    unresolved: asBoolean(value.unresolved) ?? false,
  };
}

function normalizeCanvasAiAnnotation(value: unknown): CanvasAiAnnotation | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asString(value.id);
  const targetGraphId = asString(value.targetGraphId);
  const content = asString(value.content);
  const createdAt = asString(value.createdAt);
  const annotationKind = asString(value.annotationKind);
  if (!id || !targetGraphId || !content || !createdAt || !annotationKind) {
    return null;
  }
  return {
    id,
    targetGraphId,
    targetNodeIds: asStringArray(value.targetNodeIds),
    targetEdgeIds: asStringArray(value.targetEdgeIds),
    annotationKind,
    content,
    createdAt,
  };
}

function normalizeCanvasSemanticGraphs(value: unknown): CanvasSemanticGraph[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((graph) => {
    const normalized = normalizeCanvasSemanticGraph(graph);
    return normalized ? [normalized] : [];
  });
}

function normalizeCanvasAiAnnotations(value: unknown): CanvasAiAnnotation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const normalized = normalizeCanvasAiAnnotation(item);
    return normalized ? [normalized] : [];
  });
}

function buildIndexEntry(document: IntentCanvasDocument): IntentCanvasIndexEntry {
  const safeCanvasId = normalizeCanvasId(document.id);
  if (!safeCanvasId) {
    throw new Error(`Invalid Intent Canvas id: ${document.id}`);
  }
  return {
    id: safeCanvasId,
    title: document.title,
    mode: document.mode,
    summary: document.summary,
    updatedAt: document.updatedAt,
    createdAt: document.createdAt,
    path: resolveDocumentPath(safeCanvasId),
    linkedFileCount: document.links.filePaths.length,
    linkedProjectMapNodeCount: document.links.projectMapNodeIds.length,
    linkedThreadCount: document.links.threadIds.length,
    elementCount: document.scene.elements.filter((element) => !element.isDeleted).length,
  };
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function normalizeIndexEntry(value: unknown): IntentCanvasIndexEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeCanvasId(value.id);
  const title = asString(value.title);
  const updatedAt = asString(value.updatedAt);
  const createdAt = asString(value.createdAt) ?? updatedAt;
  if (!id || !title || !updatedAt || !createdAt) {
    return null;
  }
  return {
    id,
    title,
    path: resolveDocumentPath(id),
    updatedAt,
    createdAt,
    mode: normalizeMode(value.mode),
    summary: asString(value.summary) ?? "",
    linkedFileCount: normalizeCount(value.linkedFileCount),
    linkedProjectMapNodeCount: normalizeCount(value.linkedProjectMapNodeCount),
    linkedThreadCount: normalizeCount(value.linkedThreadCount),
    elementCount: normalizeCount(value.elementCount),
  };
}

function normalizeIndexFile(value: unknown): IntentCanvasIndexFile {
  if (!isRecord(value) || !Array.isArray(value.canvases)) {
    return { version: 1, canvases: [] };
  }
  return {
    version: 1,
    canvases: value.canvases.flatMap((entry) => {
      const normalized = normalizeIndexEntry(entry);
      return normalized ? [normalized] : [];
    }),
  };
}

export function normalizeIntentCanvasDocument(value: unknown): IntentCanvasDocument | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeCanvasId(value.id);
  const title = asString(value.title);
  const createdAt = asString(value.createdAt);
  const updatedAt = asString(value.updatedAt);
  const workspace = isRecord(value.workspace) ? value.workspace : null;
  const workspaceId = asString(workspace?.id);
  if (!id || !title || !createdAt || !updatedAt || !workspaceId || value.kind !== "intent-canvas") {
    return null;
  }
  const links = normalizeLinks(value.links);
  const scene = isRecord(value.scene)
    ? sanitizeIntentCanvasScene(
        Array.isArray(value.scene.elements) ? value.scene.elements : [],
        isRecord(value.scene.appState) ? value.scene.appState : {},
        isRecord(value.scene.files) ? value.scene.files : {},
      )
    : createInitialIntentCanvasScene(null);
  const summary = asString(value.summary) ?? "";
  const semanticGraphs = normalizeCanvasSemanticGraphs(value.semanticGraphs);
  const aiAnnotations = normalizeCanvasAiAnnotations(value.aiAnnotations);
  return {
    version: 1,
    id,
    title,
    kind: "intent-canvas",
    createdAt,
    updatedAt,
    workspace: {
      id: workspaceId,
      name: asString(workspace?.name),
    },
    mode: normalizeMode(value.mode),
    summary,
    links,
    scene,
    aiContext: buildIntentCanvasAiContext(scene, summary),
    semanticGraphs,
    aiAnnotations,
  };
}

function cloneCanvasSourceAnchor(value: CanvasSourceAnchor): CanvasSourceAnchor {
  return {
    ...value,
  };
}

function cloneCanvasSemanticNode(value: CanvasSemanticNode): CanvasSemanticNode {
  return {
    ...value,
    sourceAnchor: value.sourceAnchor ? cloneCanvasSourceAnchor(value.sourceAnchor) : value.sourceAnchor,
    evidenceIds: value.evidenceIds ? [...value.evidenceIds] : undefined,
  };
}

function cloneCanvasSemanticEdge(value: CanvasSemanticEdge): CanvasSemanticEdge {
  return {
    ...value,
    sourceAnchor: value.sourceAnchor ? cloneCanvasSourceAnchor(value.sourceAnchor) : value.sourceAnchor,
    evidenceIds: value.evidenceIds ? [...value.evidenceIds] : undefined,
    evidenceRefs: value.evidenceRefs ? value.evidenceRefs.map((entry) => ({ ...entry })) : undefined,
    evidenceSummary: value.evidenceSummary ? [...value.evidenceSummary] : undefined,
  };
}

function cloneCanvasGraph(value: CanvasSemanticGraph): CanvasSemanticGraph {
  return {
    ...value,
    sourceSelection: value.sourceSelection ? { ...value.sourceSelection } : value.sourceSelection,
    nodes: value.nodes.map(cloneCanvasSemanticNode),
    edges: value.edges.map(cloneCanvasSemanticEdge),
    importOptions: value.importOptions
      ? {
          depth: value.importOptions.depth,
          direction: value.importOptions.direction,
          centerNodeId: value.importOptions.centerNodeId,
          maxNodes: value.importOptions.maxNodes,
          maxEdges: value.importOptions.maxEdges,
          omittedNodes: value.importOptions.omittedNodes,
          omittedEdges: value.importOptions.omittedEdges,
        }
      : undefined,
  };
}

function cloneCanvasAiAnnotation(value: CanvasAiAnnotation): CanvasAiAnnotation {
  return {
    ...value,
    targetNodeIds: value.targetNodeIds ? [...value.targetNodeIds] : undefined,
    targetEdgeIds: value.targetEdgeIds ? [...value.targetEdgeIds] : undefined,
  };
}

export async function loadIntentCanvasIndex(
  workspaceId: string,
): Promise<IntentCanvasLoadResult<IntentCanvasIndexEntry[]>> {
  try {
    const response = await readProjectCanvasFile(workspaceId, INTENT_CANVAS_INDEX_PATH);
    const parsed = JSON.parse(response.content) as unknown;
    const indexFile = normalizeIndexFile(parsed);
    return {
      value: indexFile.canvases.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      warnings: [],
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { value: [], warnings: [] };
    }
    return {
      value: [],
      warnings: [`Failed to load Intent Canvas index: ${normalizeErrorMessage(error)}`],
    };
  }
}

export async function loadIntentCanvasDocument(
  workspaceId: string,
  canvasId: string,
): Promise<IntentCanvasDocument> {
  const response = await readProjectCanvasFile(workspaceId, resolveDocumentPath(canvasId));
  const parsed = JSON.parse(response.content) as unknown;
  const document = normalizeIntentCanvasDocument(parsed);
  if (!document) {
    throw new Error(`Invalid Intent Canvas document: ${canvasId}`);
  }
  return document;
}

async function writeIndex(workspaceId: string, entries: IntentCanvasIndexEntry[]): Promise<void> {
  const indexFile: IntentCanvasIndexFile = {
    version: 1,
    canvases: entries.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  };
  await writeProjectCanvasFile(workspaceId, INTENT_CANVAS_INDEX_PATH, JSON.stringify(indexFile, null, 2));
}

export async function saveIntentCanvasDocument(
  workspaceId: string,
  document: IntentCanvasDocument,
): Promise<IntentCanvasDocument> {
  const now = new Date().toISOString();
  const nextDocument: IntentCanvasDocument = {
    ...document,
    updatedAt: now,
    aiContext: buildIntentCanvasAiContext(document.scene, document.summary),
  };
  await writeProjectCanvasFile(
    workspaceId,
    resolveDocumentPath(nextDocument.id),
    JSON.stringify(nextDocument, null, 2),
  );
  const indexResult = await loadIntentCanvasIndex(workspaceId);
  const nextEntry = buildIndexEntry(nextDocument);
  const nextEntries = [
    nextEntry,
    ...indexResult.value.filter((entry) => entry.id !== nextDocument.id),
  ];
  await writeIndex(workspaceId, nextEntries);
  return nextDocument;
}

export async function deleteIntentCanvasDocuments(
  workspaceId: string,
  canvasIds: string[],
): Promise<void> {
  const uniqueCanvasIds = Array.from(
    new Set(
      canvasIds.flatMap((canvasId) => {
        const normalizedCanvasId = normalizeCanvasId(canvasId);
        return normalizedCanvasId ? [normalizedCanvasId] : [];
      }),
    ),
  );
  if (uniqueCanvasIds.length === 0) {
    return;
  }
  const indexResult = await loadIntentCanvasIndex(workspaceId);
  for (const canvasId of uniqueCanvasIds) {
    try {
      await trashProjectCanvasFile(workspaceId, resolveDocumentPath(canvasId));
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }
  const deletedCanvasIds = new Set(uniqueCanvasIds);
  await writeIndex(workspaceId, indexResult.value.filter((entry) => !deletedCanvasIds.has(entry.id)));
  await compactProjectCanvasFiles(workspaceId);
}

export async function deleteIntentCanvasDocument(
  workspaceId: string,
  canvasId: string,
): Promise<void> {
  await deleteIntentCanvasDocuments(workspaceId, [canvasId]);
}

export function createIntentCanvasDocument(input: {
  workspace: IntentCanvasWorkspaceRef;
  request?: IntentCanvasOpenRequest | null;
}): IntentCanvasDocument {
  const now = new Date().toISOString();
  const id = createCanvasId();
  const source = input.request?.source ?? null;
  const seedSemanticGraphs = collectSeedSemanticGraphs(input.request?.seedSemanticGraphs);
  const title =
    input.request?.title?.trim() ||
    source?.nodeTitle?.trim() ||
    source?.filePath?.trim() ||
    "Untitled Intent Canvas";
  const summary = input.request?.summary?.trim() || source?.summary?.trim() || "";
  const links: IntentCanvasLinks = {
    projectMapNodeIds: uniqueStrings([
      ...source?.projectMapNodeId ? [source.projectMapNodeId] : [],
      ...collectSeedProjectMapNodeIds(seedSemanticGraphs),
    ]),
    filePaths: uniqueStrings([
      ...source?.filePath ? [source.filePath] : [],
      ...collectSeedFilePaths(seedSemanticGraphs),
    ]),
    threadIds: [],
  };
  const scene = createInitialIntentCanvasScene(source, seedSemanticGraphs);
  return {
    version: 1,
    id,
    title,
    kind: "intent-canvas",
    createdAt: now,
    updatedAt: now,
    workspace: input.workspace,
    mode: input.request?.mode ?? "architect",
    summary,
    links,
    scene,
    aiContext: buildIntentCanvasAiContext(scene, summary),
    semanticGraphs: seedSemanticGraphs,
    aiAnnotations: [],
  };
}

function getIntentCanvasSceneRightEdge(scene: IntentCanvasScene): number {
  return scene.elements.reduce((rightEdge, element) => {
    const rawElement = element as unknown as Record<string, unknown>;
    const x = typeof rawElement.x === "number" && Number.isFinite(rawElement.x) ? rawElement.x : 0;
    const width = typeof rawElement.width === "number" && Number.isFinite(rawElement.width) ? rawElement.width : 0;
    return Math.max(rightEdge, x + width);
  }, 0);
}

function offsetIntentCanvasScene(scene: IntentCanvasScene, offsetX: number, offsetY: number): IntentCanvasScene {
  const elements = scene.elements.map((element) => {
    const rawElement = element as unknown as Record<string, unknown>;
    return {
      ...rawElement,
      x: typeof rawElement.x === "number" && Number.isFinite(rawElement.x)
        ? rawElement.x + offsetX
        : rawElement.x,
      y: typeof rawElement.y === "number" && Number.isFinite(rawElement.y)
        ? rawElement.y + offsetY
        : rawElement.y,
    };
  }) as unknown as IntentCanvasScene["elements"];
  return sanitizeIntentCanvasScene(elements, scene.appState, scene.files);
}

function appendIntentCanvasScene(currentScene: IntentCanvasScene, appendedScene: IntentCanvasScene): IntentCanvasScene {
  const currentRightEdge = getIntentCanvasSceneRightEdge(currentScene);
  const offsetX = currentRightEdge > 0 ? Math.ceil((currentRightEdge + 160) / 40) * 40 : 0;
  const shiftedScene = offsetIntentCanvasScene(appendedScene, offsetX, 0);
  return sanitizeIntentCanvasScene(
    [...currentScene.elements, ...shiftedScene.elements],
    currentScene.appState,
    {
      ...currentScene.files,
      ...shiftedScene.files,
    },
  );
}

function appendIntentCanvasSummary(currentSummary: string, nextSummary: string): string {
  const current = currentSummary.trim();
  const next = nextSummary.trim();
  if (!next || current.includes(next)) {
    return current;
  }
  return current ? `${current}\n\n${next}` : next;
}

export function appendIntentCanvasDocumentFromRequest(input: {
  document: IntentCanvasDocument;
  request: IntentCanvasOpenRequest;
}): IntentCanvasDocument {
  const now = new Date().toISOString();
  const source = input.request.source ?? null;
  const seedSemanticGraphs = collectSeedSemanticGraphs(input.request.seedSemanticGraphs);
  const appendedScene = createInitialIntentCanvasScene(source, seedSemanticGraphs);
  const scene = appendIntentCanvasScene(input.document.scene, appendedScene);
  const summary = appendIntentCanvasSummary(
    input.document.summary,
    input.request.summary?.trim() || source?.summary?.trim() || "",
  );
  const links: IntentCanvasLinks = {
    projectMapNodeIds: uniqueStrings([
      ...input.document.links.projectMapNodeIds,
      ...source?.projectMapNodeId ? [source.projectMapNodeId] : [],
      ...collectSeedProjectMapNodeIds(seedSemanticGraphs),
    ]),
    filePaths: uniqueStrings([
      ...input.document.links.filePaths,
      ...source?.filePath ? [source.filePath] : [],
      ...collectSeedFilePaths(seedSemanticGraphs),
    ]),
    threadIds: input.document.links.threadIds,
  };
  return {
    ...input.document,
    updatedAt: now,
    summary,
    links,
    scene,
    aiContext: buildIntentCanvasAiContext(scene, summary),
    semanticGraphs: [
      ...input.document.semanticGraphs.map(cloneCanvasGraph),
      ...seedSemanticGraphs,
    ],
  };
}

export function cloneIntentCanvasDocument(input: {
  workspace: IntentCanvasWorkspaceRef;
  source: IntentCanvasDocument;
}): IntentCanvasDocument {
  const now = new Date().toISOString();
  const id = createCanvasId();
  const title = `${input.source.title} Copy`;
  return {
    ...input.source,
    semanticGraphs: input.source.semanticGraphs.map(cloneCanvasGraph),
    aiAnnotations: input.source.aiAnnotations.map(cloneCanvasAiAnnotation),
    id,
    title,
    createdAt: now,
    updatedAt: now,
    workspace: input.workspace,
  };
}
