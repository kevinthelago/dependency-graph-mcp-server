import type { NodeId } from "../graph/model.js";
import type { GraphView } from "../graph/store.js";
import { fileId, symbolId, nodeKind } from "../graph/node-id.js";
import type { ResolveResult } from "./types.js";

/**
 * Resolve a user-supplied target string to a node in the graph.
 *
 * Accepts:
 *  - Raw node IDs (file:..., sym:..., ext:...)
 *  - Absolute file paths
 *  - Relative file paths (matched suffix-first)
 *  - "path/to/file.ts#Symbol" shorthand
 */
export function resolveTarget(view: GraphView, target: string): ResolveResult {
  // Direct node id lookup
  if (
    target.startsWith("file:") ||
    target.startsWith("sym:") ||
    target.startsWith("ext:")
  ) {
    if (view.hasNode(target as NodeId)) {
      return { kind: "found", id: target as NodeId };
    }
    return { kind: "notFound", message: `Node not found: ${target}` };
  }

  // "path/to/file.ts#Symbol" shorthand
  const hashIdx = target.lastIndexOf("#");
  if (hashIdx > 0) {
    const filePart = target.slice(0, hashIdx);
    const symPart = target.slice(hashIdx + 1);
    return resolveFileSymbol(view, filePart, symPart);
  }

  // Pure file path
  return resolveFilePath(view, target);
}

function resolveFilePath(view: GraphView, path: string): ResolveResult {
  // Try exact match as absolute path
  const exactId = fileId(path);
  if (view.hasNode(exactId)) {
    return { kind: "found", id: exactId };
  }

  // Suffix match against all file nodes
  const normalized = path.replace(/\\/g, "/");
  const candidates = view
    .nodes()
    .filter((id) => {
      if (nodeKind(id) !== "file") return false;
      const nodePath = id.slice(5).replace(/\\/g, "/");
      return nodePath === normalized || nodePath.endsWith("/" + normalized);
    });

  if (candidates.length === 1) {
    return { kind: "found", id: candidates[0] as NodeId };
  }
  if (candidates.length > 1) {
    return {
      kind: "candidates",
      items: candidates as NodeId[],
      message: `Ambiguous target "${path}" — ${candidates.length} matches`,
    };
  }
  return { kind: "notFound", message: `File not found: ${path}` };
}

function resolveFileSymbol(
  view: GraphView,
  filePath: string,
  symbolName: string
): ResolveResult {
  // Resolve the file first
  const fileResult = resolveFilePath(view, filePath);
  if (fileResult.kind === "notFound") return fileResult;
  if (fileResult.kind === "candidates") return fileResult;

  const containingFilePath = fileResult.id.slice(5); // strip "file:"
  const symNodeId = symbolId(containingFilePath, symbolName);
  if (view.hasNode(symNodeId)) {
    return { kind: "found", id: symNodeId };
  }
  return {
    kind: "notFound",
    message: `Symbol "${symbolName}" not found in ${filePath}`,
  };
}
