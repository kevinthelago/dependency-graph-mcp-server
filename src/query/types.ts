import type { GraphView } from "../graph/store.js";

/** Context passed to every tool handler. */
export interface ToolContext {
  /** Worktree this query is scoped to. */
  worktreeId: string;
  /** Composed view (base + overlay for this worktree). */
  view: GraphView;
}
