import type { NodeId, NodeKind } from "./model.js";

export function fileId(absolutePath: string): NodeId {
  return `file:${absolutePath}`;
}

export function symbolId(absolutePath: string, symbolName: string): NodeId {
  return `sym:${absolutePath}#${symbolName}`;
}

export function externalId(packageSpec: string): NodeId {
  return `ext:${packageSpec}`;
}

export function nodeKind(id: NodeId): NodeKind {
  if (id.startsWith("file:")) return "file";
  if (id.startsWith("sym:")) return "symbol";
  return "external";
}

/** Returns the file path embedded in a file: or sym: node id, or null for ext: */
export function nodeFilePath(id: NodeId): string | null {
  if (id.startsWith("file:")) return id.slice(5);
  if (id.startsWith("sym:")) return id.slice(4, id.indexOf("#"));
  return null;
}

/** For sym:, returns just the symbol portion after '#'. */
export function nodeSymbolName(id: NodeId): string | null {
  if (!id.startsWith("sym:")) return null;
  const hash = id.indexOf("#");
  return hash >= 0 ? id.slice(hash + 1) : null;
}

/**
 * Given a sym: node id, return the file: id of its container.
 * Returns null for file:/ext: ids.
 */
export function containingFileId(id: NodeId): NodeId | null {
  const path = nodeFilePath(id);
  if (!path || id.startsWith("file:")) return null;
  return fileId(path);
}

/** Returns a short human-readable label for display purposes. */
export function displayName(id: NodeId): string {
  if (id.startsWith("file:")) {
    const path = id.slice(5);
    return path.split(/[\\/]/).pop() ?? path;
  }
  if (id.startsWith("sym:")) {
    const sym = nodeSymbolName(id);
    return sym ?? id;
  }
  return id.slice(4); // ext: → strip prefix
}
