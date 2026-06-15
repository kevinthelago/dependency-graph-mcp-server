import type { NodeId, NodeKind } from "../graph/model.js";
import type { GraphView } from "../graph/store.js";

/** Result of resolving a user-supplied target string to a graph node. */
export type ResolveResult =
  | { kind: "found"; id: NodeId }
  | { kind: "candidates"; items: NodeId[]; message: string }
  | { kind: "notFound"; message: string };

/** Context passed to every tool handler. */
export interface ToolContext {
  /** The worktree this query is scoped to. */
  worktreeId: string;
  /** Composed view (base + overlay for this worktree). */
  view: GraphView;
}

/** A single entry in a traversal result. */
export interface TraversalEntry {
  id: NodeId;
  kind: NodeKind;
  displayName: string;
  /** Hop distance from the origin node (1 = direct). */
  distance: number;
  /** One example path from origin → this node, as a list of node ids. */
  examplePath?: NodeId[];
}

/** Standard pagination / truncation envelope used by all query tools. */
export interface PageInfo {
  truncated: boolean;
  cursor?: string;
  total: number;
}
