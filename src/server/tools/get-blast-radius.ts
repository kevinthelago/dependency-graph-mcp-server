import { z } from "zod";
import { resolveTarget, parseStringTarget } from "../../query/resolver.js";
import { reverseBlastBfs } from "../../query/traversal.js";
import {
  containingFileId,
  displayName as nodeDisplayName,
} from "../../graph/node-id.js";
import type { ToolContext, TraversalEntry } from "../../query/types.js";
import type { NodeId } from "../../graph/model.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const GetBlastRadiusInput = z.object({
  /** Node id, file path, or "path/to/file.ts#Symbol" shorthand. */
  target: z.string().min(1, "target is required"),
  /** Maximum traversal depth. Omit for full transitive closure. */
  maxDepth: z.number().int().positive().optional(),
  /**
   * When true, symbol-level dependents are also aggregated under their
   * containing file node. The file entry carries `rolledUp: true`.
   */
  rollUp: z.boolean().default(false),
  /**
   * When true, each dependent entry includes one example dependency path
   * showing how it reaches the target.
   */
  includePaths: z.boolean().default(false),
  /** Worktree to scope the query to. Uses the base graph when omitted. */
  worktreeId: z.string().optional(),
});

export type GetBlastRadiusInput = z.infer<typeof GetBlastRadiusInput>;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface DependentEntry {
  id: NodeId;
  kind: "file" | "symbol" | "external";
  displayName: string;
  /** Hop count from the target (1 = directly imports/references the target). */
  distance: number;
  /**
   * One example path: [dependent, …intermediates…, target].
   * Only populated when includePaths is true.
   */
  examplePath?: NodeId[];
  /**
   * Only present on file entries when rollUp is true.
   * True means this file appeared because one or more of its symbols
   * are in the dependent set (it may not directly import the target).
   */
  rolledUp?: boolean;
}

export interface BlastRadiusResult {
  /** Resolved node id of the target. */
  targetId: NodeId;
  dependents: DependentEntry[];
  /** True when there are zero dependents — the target is safe to change in isolation. */
  safeToChange: boolean;
  /** True when results were capped by the internal limit. */
  truncated: boolean;
  /** Total discovered dependents (may exceed dependents.length when truncated). */
  total: number;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const RESULT_LIMIT = 2_000;

export async function getBlastRadius(
  input: GetBlastRadiusInput,
  ctx: ToolContext
): Promise<BlastRadiusResult> {
  const { target, maxDepth, rollUp, includePaths } = input;
  const { view } = ctx;

  // 1. Resolve the target string to a node id
  const resolved = resolveTarget(view, parseStringTarget(target));
  if ("notFound" in resolved) {
    throw new Error(`Target not found: ${target}`);
  }
  if ("candidates" in resolved) {
    throw new Error(
      `Ambiguous target "${target}" — ${resolved.candidates.length} matches. Disambiguate by using the full node id or an absolute path.`,
    );
  }

  const targetId = resolved.id;

  // 2. Reverse BFS to collect all transitive dependents
  const bfsResult = reverseBlastBfs(view, targetId, {
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    includePaths,
    limit: RESULT_LIMIT,
  });

  // 3. Optionally roll up symbol-level hits into their containing file nodes
  const { entries, rolledUpIds } = rollUp
    ? applyRollUp(bfsResult.entries)
    : { entries: bfsResult.entries, rolledUpIds: new Set<NodeId>() };

  // 4. Build output
  const dependents: DependentEntry[] = entries.map((e) => {
    const entry: DependentEntry = {
      id: e.id,
      kind: e.kind,
      displayName: e.displayName,
      distance: e.distance,
    };
    if (e.examplePath !== undefined) entry.examplePath = e.examplePath;
    if (rolledUpIds.has(e.id)) entry.rolledUp = true;
    return entry;
  });

  return {
    targetId,
    dependents,
    safeToChange: dependents.length === 0,
    truncated: bfsResult.truncated,
    total: bfsResult.total,
  };
}

// ---------------------------------------------------------------------------
// Roll-up: aggregate symbol dependents under their containing file
// ---------------------------------------------------------------------------

interface RollUpResult {
  entries: TraversalEntry[];
  rolledUpIds: Set<NodeId>;
}

function applyRollUp(entries: TraversalEntry[]): RollUpResult {
  const byId = new Map<NodeId, TraversalEntry>();
  const rolledUpIds = new Set<NodeId>();

  for (const entry of entries) {
    byId.set(entry.id, entry);

    if (entry.kind === "symbol") {
      const fileNodeId = containingFileId(entry.id);
      if (fileNodeId !== null && !byId.has(fileNodeId)) {
        // Synthesise a file entry at the minimum distance seen for any of its symbols.
        // Update if we later find a closer symbol from this same file.
        const existing = byId.get(fileNodeId);
        if (existing === undefined || entry.distance < existing.distance) {
          byId.set(fileNodeId, {
            id: fileNodeId,
            kind: "file",
            displayName: nodeDisplayName(fileNodeId),
            distance: entry.distance,
          });
          rolledUpIds.add(fileNodeId);
        }
      }
    }
  }

  // Sort by distance then id for determinism
  const sorted = Array.from(byId.values()).sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { entries: sorted, rolledUpIds };
}

// ---------------------------------------------------------------------------
// MCP tool definition (registered by the server bootstrap)
// ---------------------------------------------------------------------------

export const blastRadiusToolDef = {
  name: "get_blast_radius",
  description:
    "Find all files and symbols that transitively depend on a given target. " +
    "Returns an empty dependent list with safeToChange=true when nothing imports the target.",
  inputSchema: GetBlastRadiusInput,
  handler: getBlastRadius,
} as const;
