import type { NodeId } from "../graph/model.js";
import { fileId, symbolId, nodeKind } from "../graph/node-id.js";
import type { ResolveResult } from "./types.js";

/** Minimal duck-type the resolver needs from a graph view. */
export interface Resolvable {
  hasNode(id: string): boolean;
  /** Optional — required for suffix/ambiguous path matching. */
  nodes?(): string[];
}

/** Target union as defined in the contract. */
export type ResolveTarget =
  | { nodeId: string }
  | { path: string }
  | { path: string; symbol: string };

/**
 * Parse a legacy string target (node-id, "path#symbol", or file path)
 * into the contract's structured ResolveTarget.
 */
export function parseStringTarget(target: string): ResolveTarget {
  if (
    target.startsWith("file:") ||
    target.startsWith("sym:") ||
    target.startsWith("ext:")
  ) {
    return { nodeId: target };
  }
  const hashIdx = target.lastIndexOf("#");
  if (hashIdx > 0) {
    return { path: target.slice(0, hashIdx), symbol: target.slice(hashIdx + 1) };
  }
  return { path: target };
}

/**
 * Resolve a user-supplied target to a node in the graph.
 * Accepts: { nodeId }, { path }, or { path, symbol }.
 */
export function resolveTarget(view: Resolvable, target: ResolveTarget): ResolveResult {
  if ("nodeId" in target) {
    return resolveNodeId(view, target.nodeId);
  }
  if ("symbol" in target) {
    return resolveFileSymbol(view, target.path, target.symbol);
  }
  return resolveFilePath(view, target.path);
}

function resolveNodeId(view: Resolvable, nodeId: string): ResolveResult {
  if (view.hasNode(nodeId)) {
    return { id: nodeId as NodeId };
  }
  return { notFound: true };
}

function resolveFilePath(view: Resolvable, path: string): ResolveResult {
  const exactId = fileId(path);
  if (view.hasNode(exactId)) {
    return { id: exactId };
  }

  const allNodes = view.nodes?.() ?? [];
  const normalized = path.replace(/\\/g, "/");
  const candidates = allNodes.filter((id) => {
    if (nodeKind(id) !== "file") return false;
    const nodePath = id.slice(5).replace(/\\/g, "/");
    return nodePath === normalized || nodePath.endsWith("/" + normalized);
  });

  if (candidates.length === 1) {
    return { id: candidates[0] as NodeId };
  }
  if (candidates.length > 1) {
    return { candidates: candidates as NodeId[] };
  }
  return { notFound: true };
}

function resolveFileSymbol(
  view: Resolvable,
  filePath: string,
  symbolName: string,
): ResolveResult {
  const fileResult = resolveFilePath(view, filePath);
  if ("notFound" in fileResult || "candidates" in fileResult) return fileResult;

  const containingFilePath = fileResult.id.slice(5); // strip "file:"
  const symNodeId = symbolId(containingFilePath, symbolName);
  if (view.hasNode(symNodeId)) {
    return { id: symNodeId };
  }

  // No exact match — scan for symbols in this file whose name starts with symbolName
  // (handles overloaded/mangled names like foo~1, foo~2).
  const symPrefix = `sym:${containingFilePath}#${symbolName}`;
  const allNodes = view.nodes?.() ?? [];
  const candidates = allNodes.filter((id) => id.startsWith(symPrefix));
  if (candidates.length === 1) {
    return { id: candidates[0] as NodeId };
  }
  if (candidates.length > 1) {
    return { candidates: candidates as NodeId[] };
  }

  return { notFound: true };
}
