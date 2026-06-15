import { z } from "zod";
import { nodeKind, nodeFilePath } from "../../graph/node-id.js";
import { tarjanSCC, findExampleCyclePath } from "../../query/scc.js";
import type { ToolContext } from "../../query/types.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const DetectCyclesInput = z.object({
  /**
   * 'module' (default): detect cycles at the file granularity only.
   * 'symbol': also include symbol-level nodes in cycle detection.
   */
  granularity: z.enum(["module", "symbol"]).default("module"),
  /**
   * Optional path-prefix filter. When provided, only nodes whose file path
   * starts with this prefix are considered. Useful for scoping to a
   * subdirectory, e.g. "src/api/".
   */
  scope: z.string().optional(),
  /**
   * Maximum number of nodes to include in each cycle group's `nodes` array.
   * Groups with more nodes are still reported but have `truncated: true` on
   * the group entry. Default: 50.
   */
  maxGroupSize: z.number().int().positive().default(50),
  /** Worktree to scope the query to. Uses the base graph when omitted. */
  worktreeId: z.string().optional(),
});

export type DetectCyclesInput = z.infer<typeof DetectCyclesInput>;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface CycleGroup {
  /** Deterministic, stable group ID derived from the sorted node IDs. */
  id: string;
  /** Total number of nodes in this SCC (may exceed nodes.length when truncated). */
  size: number;
  /** Sorted node IDs in this group (may be truncated to maxGroupSize). */
  nodes: string[];
  /**
   * One example cycle path through the group, starting and ending at the
   * same (lexicographically smallest) node.
   * Self-loops: [node, node]. Multi-node: [a, b, …, a].
   */
  exampleCyclePath: string[];
  /** True when the nodes array was capped by maxGroupSize. */
  truncated: boolean;
}

export interface DetectCyclesResult {
  /** Detected cycle groups, sorted by size (desc) then min node ID (asc). */
  groups: CycleGroup[];
  /** True when total groups exceeded the internal per-call limit. */
  truncated: boolean;
  /** Total cycle groups found (may exceed groups.length when truncated). */
  totalGroups: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUPS_LIMIT = 500;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function detectCycles(
  input: DetectCyclesInput,
  ctx: ToolContext,
): DetectCyclesResult {
  const { granularity, scope, maxGroupSize } = input;
  const { view } = ctx;

  // 1. Collect nodes that match granularity + scope filters.
  //    External nodes are never part of meaningful dependency cycles.
  const filteredNodes: string[] = [];

  for (const nodeId of view.nodes()) {
    const kind = nodeKind(nodeId);
    if (kind === "external") continue;
    if (granularity === "module" && kind !== "file") continue;

    if (scope !== undefined) {
      const filePath = nodeFilePath(nodeId);
      if (filePath === null || !filePath.startsWith(scope)) continue;
    }

    filteredNodes.push(nodeId);
  }

  // Sort for determinism — Tarjan's visits nodes in the provided order.
  filteredNodes.sort();

  const filteredSet = new Set(filteredNodes);

  // 2. Successor function restricted to the filtered node set.
  function getSuccessors(nodeId: string): string[] {
    return view.outNeighbors(nodeId).filter((w) => filteredSet.has(w)).sort();
  }

  // Self-loop: the node appears in its own outNeighbors list.
  function hasSelfEdge(nodeId: string): boolean {
    return view.outNeighbors(nodeId).includes(nodeId);
  }

  // 3. Run Tarjan's SCC.
  const components = tarjanSCC(filteredNodes, getSuccessors);

  // 4. Keep only cycle components: size > 1 OR single-node self-loop.
  const cycleComponents = components.filter(
    (c) => c.length > 1 || (c.length === 1 && hasSelfEdge(c[0]!)),
  );

  // 5. Sort deterministically: larger groups first, then by lexicographic min node ID.
  cycleComponents.sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length;
    const minA = a.slice().sort()[0] ?? "";
    const minB = b.slice().sort()[0] ?? "";
    return minA < minB ? -1 : minA > minB ? 1 : 0;
  });

  const totalGroups = cycleComponents.length;
  const truncated = totalGroups > GROUPS_LIMIT;
  const visibleComponents = truncated
    ? cycleComponents.slice(0, GROUPS_LIMIT)
    : cycleComponents;

  // 6. Build output groups.
  const groups: CycleGroup[] = visibleComponents.map((sccNodes) => {
    const sortedNodes = sccNodes.slice().sort();
    const groupTruncated = sortedNodes.length > maxGroupSize;
    const visibleNodes = groupTruncated
      ? sortedNodes.slice(0, maxGroupSize)
      : sortedNodes;
    const exampleCyclePath = findExampleCyclePath(sortedNodes, getSuccessors);
    const groupId = makeGroupId(sortedNodes);

    return {
      id: groupId,
      size: sortedNodes.length,
      nodes: visibleNodes,
      exampleCyclePath,
      truncated: groupTruncated,
    };
  });

  return { groups, truncated, totalGroups };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic group ID: djb2-like hash of the pipe-joined sorted node IDs. */
function makeGroupId(sortedNodeIds: string[]): string {
  const str = sortedNodeIds.join("|");
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return `scc-${(hash >>> 0).toString(16)}`;
}

// ---------------------------------------------------------------------------
// MCP tool definition (registered by the server bootstrap)
// ---------------------------------------------------------------------------

export const detectCyclesToolDef = {
  name: "detect_cycles",
  description:
    "Detect circular dependency groups in the codebase using Tarjan's SCC algorithm. " +
    "Returns groups of nodes that form cycles (including self-loops). " +
    "Module granularity (default) operates at the file level; " +
    "symbol granularity additionally finds symbol-to-symbol cycles.",
  inputSchema: DetectCyclesInput,
  handler: detectCycles,
} as const;
