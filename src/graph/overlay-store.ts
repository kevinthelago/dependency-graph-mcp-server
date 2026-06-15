import type { GraphInstance, GraphView } from "./store.js";
import type { NodeAttrs, EdgeAttrs, NodeId } from "./model.js";
import { createGraph, createGraphView } from "./store.js";
import { DirectedGraph } from "graphology";

export type WorktreeId = string;

/** Marker for a file deleted in an overlay. */
const DELETED = Symbol("deleted");

interface OverlayFileEntry {
  nodes: Array<{ id: NodeId; attrs: NodeAttrs }>;
  edges: Array<{ from: NodeId; to: NodeId; attrs: EdgeAttrs }>;
}

type OverlayEntry = OverlayFileEntry | typeof DELETED;

/** A file slice: all nodes and edges belonging to one source file. */
export interface FileSlice {
  filePath: string;
  nodes: Array<{ id: NodeId; attrs: NodeAttrs }>;
  edges: Array<{ from: NodeId; to: NodeId; attrs: EdgeAttrs }>;
}

/**
 * OverlayStore: base GraphInstance + per-worktree file-level overlays.
 *
 * The base graph holds the indexed state of the base branch.
 * Each worktree gets its own overlay map (filePath -> slice | DELETED).
 * composedView(worktreeId) returns a read-only GraphView that layers
 * the worktree's overlay on top of the base, at file granularity.
 */
export class OverlayStore {
  readonly base: GraphInstance = createGraph();
  private overlays = new Map<WorktreeId, Map<string, OverlayEntry>>();
  /** base: filePath -> node ids contained in that file */
  private baseFileIndex = new Map<string, Set<NodeId>>();
  /** base: filePath -> edges originating in that file */
  private baseEdgeIndex = new Map<string, Array<[NodeId, NodeId, string]>>();

  applyBaseSlice(slice: FileSlice): void {
    this._removeBaseSlice(slice.filePath);
    const nodeIds = new Set<NodeId>();
    for (const { id, attrs } of slice.nodes) {
      if (!this.base.hasNode(id)) {
        this.base.addNode(id, attrs);
      } else {
        this.base.replaceNodeAttributes(id, attrs);
      }
      nodeIds.add(id);
    }
    const edgeKeys: Array<[NodeId, NodeId, string]> = [];
    for (const { from, to, attrs } of slice.edges) {
      const key = `${from}||${attrs.kind}||${to}`;
      if (!this.base.hasNode(from)) this.base.addNode(from, _stubExternal(from));
      if (!this.base.hasNode(to)) this.base.addNode(to, _stubExternal(to));
      if (this.base.hasEdge(key)) {
        this.base.replaceEdgeAttributes(key, attrs);
      } else {
        this.base.addEdgeWithKey(key, from, to, attrs);
      }
      edgeKeys.push([from, to, key]);
    }
    this.baseFileIndex.set(slice.filePath, nodeIds);
    this.baseEdgeIndex.set(slice.filePath, edgeKeys);
  }

  removeBaseSlice(filePath: string): void {
    this._removeBaseSlice(filePath);
  }

  private _removeBaseSlice(filePath: string): void {
    const edgeKeys = this.baseEdgeIndex.get(filePath);
    if (edgeKeys) {
      for (const [, , key] of edgeKeys) {
        if (this.base.hasEdge(key)) this.base.dropEdge(key);
      }
      this.baseEdgeIndex.delete(filePath);
    }
    const ids = this.baseFileIndex.get(filePath);
    if (ids) {
      for (const id of ids) {
        if (this.base.hasNode(id)) this.base.dropNode(id);
      }
      this.baseFileIndex.delete(filePath);
    }
  }

  applyOverlaySlice(worktreeId: WorktreeId, slice: FileSlice): void {
    const ov = this._getOrCreateOverlay(worktreeId);
    ov.set(slice.filePath, { nodes: slice.nodes, edges: slice.edges });
  }

  markOverlayDeleted(worktreeId: WorktreeId, filePath: string): void {
    const ov = this._getOrCreateOverlay(worktreeId);
    ov.set(filePath, DELETED);
  }

  clearOverlay(worktreeId: WorktreeId): void {
    this.overlays.delete(worktreeId);
  }

  composedView(worktreeId: WorktreeId): GraphView {
    const overlay = this.overlays.get(worktreeId) ?? new Map<string, OverlayEntry>();
    return buildComposedView(this.base, overlay, this.baseFileIndex, this.baseEdgeIndex);
  }

  private _getOrCreateOverlay(worktreeId: WorktreeId): Map<string, OverlayEntry> {
    let ov = this.overlays.get(worktreeId);
    if (!ov) {
      ov = new Map();
      this.overlays.set(worktreeId, ov);
    }
    return ov;
  }
}

function _stubExternal(id: NodeId): NodeAttrs {
  return { kind: "external", packageName: id, displayName: id };
}

function buildComposedView(
  base: GraphInstance,
  overlay: Map<string, OverlayEntry>,
  baseFileIndex: Map<string, Set<NodeId>>,
  baseEdgeIndex: Map<string, Array<[NodeId, NodeId, string]>>,
): GraphView {
  const overriddenFiles = new Set(overlay.keys());

  const activeSlices: OverlayFileEntry[] = [];
  for (const [, entry] of overlay) {
    if (entry !== DELETED) activeSlices.push(entry as OverlayFileEntry);
  }

  const overlayNodeIds = new Set<NodeId>();
  const overlayNodeMap = new Map<NodeId, NodeAttrs>();
  for (const slice of activeSlices) {
    for (const { id, attrs } of slice.nodes) {
      overlayNodeIds.add(id);
      overlayNodeMap.set(id, attrs);
    }
  }

  function isBaseNodeVisible(id: NodeId): boolean {
    for (const [filePath, ids] of baseFileIndex) {
      if (ids.has(id) && overriddenFiles.has(filePath)) return false;
    }
    return true;
  }

  const composed = new DirectedGraph<NodeAttrs, EdgeAttrs>();
  for (const id of base.nodes()) {
    if (isBaseNodeVisible(id)) composed.addNode(id, base.getNodeAttributes(id));
  }
  for (const [, , key] of [...baseEdgeIndex.values()].flat()) {
    if (base.hasEdge(key)) {
      const [from, to] = [base.source(key), base.target(key)];
      if (composed.hasNode(from) && composed.hasNode(to) && !composed.hasEdge(key)) {
        composed.addEdgeWithKey(key, from, to, base.getEdgeAttributes(key));
      }
    }
  }
  for (const slice of activeSlices) {
    for (const { id, attrs } of slice.nodes) {
      if (!composed.hasNode(id)) composed.addNode(id, attrs);
      else composed.replaceNodeAttributes(id, attrs);
    }
    for (const { from, to, attrs } of slice.edges) {
      if (!composed.hasNode(from)) composed.addNode(from, _stubExternal(from));
      if (!composed.hasNode(to)) composed.addNode(to, _stubExternal(to));
      const key = `${from}||${attrs.kind}||${to}`;
      if (!composed.hasEdge(key)) composed.addEdgeWithKey(key, from, to, attrs);
      else composed.replaceEdgeAttributes(key, attrs);
    }
  }

  return createGraphView(composed);
}
