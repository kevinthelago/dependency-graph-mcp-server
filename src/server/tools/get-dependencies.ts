import { z } from "zod";
import { resolveTarget } from "../../query/resolver.js";
import { forwardBfs } from "../../query/traverse.js";
import type { ToolContext, TraversalEntry } from "../../query/types.js";
import type { NodeId } from "../../graph/model.js";
import { notFound } from "../envelope.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const GetDependenciesInput = z.object({
  /**
   * The node to start from. Accepts:
   * - A raw node id (file:…, sym:…, ext:…)
   * - An absolute or suffix-matched file path
   * - A "path/to/file.ts#Symbol" shorthand
   */
  target: z.string().min(1, "target is required"),
  /** How many hops to follow (1 = direct only). Defaults to 1, max 10. */
  depth: z.number().int().min(1).max(10).default(1),
  /**
   * Cap on returned dependency entries before truncation.
   * Defaults to 500; max 5000.
   */
  limit: z.number().int().min(1).max(5_000).default(500),
  /**
   * When true, each dependency entry includes one example path from the
   * origin node to that dependency.
   */
  includePaths: z.boolean().default(false),
});

export type GetDependenciesInput = z.infer<typeof GetDependenciesInput>;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface DependencyEntry {
  id: NodeId;
  kind: "file" | "symbol" | "external";
  displayName: string;
  /** Hop distance from the origin (1 = direct dependency). */
  distance: number;
  /**
   * One example dependency path: [origin, …intermediates…, this node].
   * Only populated when includePaths is true.
   */
  examplePath?: NodeId[];
}

export interface GetDependenciesResult {
  /** Resolved node id of the origin. */
  targetId: NodeId;
  dependencies: DependencyEntry[];
  /** True when results were capped at `limit`. */
  truncated: boolean;
  /** Total dependencies discovered (including those past the limit). */
  total: number;
}

type NotFoundResult = ReturnType<typeof notFound>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function getDependencies(
  input: GetDependenciesInput,
  ctx: ToolContext,
): Promise<GetDependenciesResult | NotFoundResult> {
  const { view } = ctx;

  const resolved = resolveTarget(view, input.target);
  if (resolved.kind === "notFound") return notFound();
  if (resolved.kind === "candidates") return notFound(resolved.items);

  const bfsResult = forwardBfs(view, resolved.id, {
    maxDepth: input.depth,
    limit: input.limit,
    includePaths: input.includePaths,
  });

  const dependencies: DependencyEntry[] = bfsResult.entries.map(
    (e: TraversalEntry) => {
      const entry: DependencyEntry = {
        id: e.id,
        kind: e.kind,
        displayName: e.displayName,
        distance: e.distance,
      };
      if (e.examplePath !== undefined) entry.examplePath = e.examplePath;
      return entry;
    },
  );

  return {
    targetId: resolved.id,
    dependencies,
    truncated: bfsResult.truncated,
    total: bfsResult.total,
  };
}

// ---------------------------------------------------------------------------
// MCP tool definition
// ---------------------------------------------------------------------------

export const getDependenciesToolDef = {
  name: "get_dependencies",
  description:
    "Return the nodes that the target depends on, following outgoing edges " +
    "up to `depth` hops. External package nodes are included but never traversed " +
    "further. Results are capped at `limit` entries (default 500); check `truncated` " +
    "and retry with a higher limit when needed.",
  inputSchema: GetDependenciesInput,
  handler: getDependencies,
} as const;
