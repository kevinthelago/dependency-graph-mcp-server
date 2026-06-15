// Stub implementation of resolveTarget — will be replaced by query-dependencies (qd-1).
// Self-contained so it doesn't conflict with the shared query/types.ts.

import type { GraphView } from '../graph/store.js';

export type TargetSpec =
  | { nodeId: string }
  | { path: string; symbol?: string };

export type ResolveResult =
  | { id: string }
  | { candidates: string[] }
  | { notFound: true };

export function resolveTarget(view: GraphView, target: TargetSpec): ResolveResult {
  if ('nodeId' in target) {
    return view.hasNode(target.nodeId)
      ? { id: target.nodeId }
      : { notFound: true };
  }

  const fileId = `file:${target.path}`;

  if (!view.hasNode(fileId)) {
    return { notFound: true };
  }

  if (!target.symbol) {
    return { id: fileId };
  }

  const exactId = `sym:${target.path}#${target.symbol}`;
  if (view.hasNode(exactId)) {
    return { id: exactId };
  }

  // Collect candidates matching the path prefix
  const prefix = `sym:${target.path}#`;
  const candidates: string[] = [];
  for (const nodeId of view.nodes()) {
    if (nodeId.startsWith(prefix)) candidates.push(nodeId);
  }

  return candidates.length > 0 ? { candidates } : { notFound: true };
}
