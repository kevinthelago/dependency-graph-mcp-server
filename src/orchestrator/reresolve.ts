import { join } from 'node:path';
import type { GraphView } from '../graph/store.js';
import type { Overlay } from '../graph/store.js';
import type { LanguageAnalyzer, ProjectContext } from '../analyzers/types.js';
import { analyzeAndApply, type CacheAccess } from './incremental.js';

export interface ReresolveContext {
  worktreeRoot: string;
  overlay: Overlay;
  getAnalyzer(absPath: string): LanguageAnalyzer | undefined;
  cache: CacheAccess;
  projectContext: ProjectContext;
}

/**
 * Re-analyze the immediate (1-hop) file-node dependents of every changed node.
 *
 * This handles the case where a file's exports change (or a previously-absent
 * file is added), and callers that had unresolved imports pointing to it need
 * to re-resolve. Only 1 degree of dependents is walked (option b).
 *
 * Returns the node IDs produced by the re-analyses.
 */
export async function reresolveOneDegree(
  changedNodeIds: string[],
  composedView: GraphView,
  ctx: ReresolveContext,
): Promise<string[]> {
  if (changedNodeIds.length === 0) return [];

  const toReresolve = new Set<string>(); // relative repo paths

  for (const nodeId of changedNodeIds) {
    if (!composedView.hasNode(nodeId)) continue;
    for (const neighborId of composedView.inNeighbors(nodeId)) {
      const attrs = composedView.getNodeAttributes(neighborId);
      if (attrs.kind !== 'file') continue;
      // File node attrs contain the relative path in `name` / `filePath`.
      const relPath =
        'filePath' in attrs
          ? (attrs.filePath as string)
          : (attrs as unknown as { name: string }).name;
      if (relPath) toReresolve.add(relPath);
    }
  }

  const reResolvedIds: string[] = [];
  for (const relPath of toReresolve) {
    const absPath = join(ctx.worktreeRoot, relPath);
    const analyzer = ctx.getAnalyzer(absPath);
    if (!analyzer) continue;
    const ids = await analyzeAndApply(
      absPath,
      relPath,
      ctx.overlay,
      analyzer,
      ctx.cache,
      ctx.projectContext,
    );
    reResolvedIds.push(...ids);
  }

  return reResolvedIds;
}
