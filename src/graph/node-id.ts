export type NodeId = string;

export function fileId(path: string): NodeId {
  return `file:${path}`;
}

export function symbolId(path: string, name: string): NodeId {
  return `sym:${path}#${name}`;
}

export function nodeKind(id: string): "file" | "symbol" | "external" {
  if (id.startsWith("file:")) return "file";
  if (id.startsWith("sym:")) return "symbol";
  return "external";
}

/** Returns the repo-relative file path from a file: or sym: id, null for ext:. */
export function nodeFilePath(id: string): string | null {
  if (id.startsWith("file:")) return id.slice(5);
  if (id.startsWith("sym:")) {
    const rest = id.slice(4);
    const hash = rest.indexOf("#");
    return hash >= 0 ? rest.slice(0, hash) : null;
  }
  return null;
}

/** Short human-readable label for display. */
export function displayName(id: string): string {
  if (id.startsWith("file:")) {
    const path = id.slice(5);
    return path.split(/[/\\]/).pop() ?? path;
  }
  if (id.startsWith("sym:")) {
    const hash = id.indexOf("#");
    return hash >= 0 ? id.slice(hash + 1) : id;
  }
  return id.slice(4);
}
