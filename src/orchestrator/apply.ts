import type { OverlayStore, WorktreeId, FileSlice } from "../graph/overlay-store.js";
import type { AnalysisFragment } from "../analyzers/types.js";
import type { NodeAttrs, EdgeAttrs, EdgeKind, FileNodeAttrs, Node } from "../graph/model.js";

const EDGE_KIND_MAP: Record<string, EdgeKind> = {
  import: "imports",
  reference: "references",
};

function nodeToAttrs(node: Node): NodeAttrs {
  if (node.kind === "file") {
    const attrs: FileNodeAttrs = {
      kind: "file",
      filePath: node.id.slice(5),
      displayName: node.name,
    };
    if (node.language != null) attrs.language = node.language;
    return attrs;
  }
  if (node.kind === "symbol") {
    return {
      kind: "symbol",
      filePath: node.file ?? node.id.slice(4, node.id.indexOf("#")),
      symbolName: node.name,
      displayName: node.name,
    };
  }
  return {
    kind: "external",
    packageName: node.name,
    displayName: node.name,
  };
}

function fragmentToSlice(filePath: string, fragment: AnalysisFragment): FileSlice {
  return {
    filePath,
    nodes: [fragment.file, ...fragment.symbols].map((n) => ({
      id: n.id,
      attrs: nodeToAttrs(n),
    })),
    edges: fragment.edges.map((e) => {
      const attrs: EdgeAttrs = { kind: EDGE_KIND_MAP[e.kind] ?? "imports" };
      if (e.loc != null) attrs.line = e.loc.line;
      return { from: e.from, to: e.to, attrs };
    }),
  };
}

export function applyBaseFile(
  store: OverlayStore,
  filePath: string,
  fragment: AnalysisFragment,
): void {
  store.applyBaseSlice(fragmentToSlice(filePath, fragment));
}

export function removeBaseFile(store: OverlayStore, filePath: string): void {
  store.removeBaseSlice(filePath);
}

export function applyOverlayFile(
  store: OverlayStore,
  worktreeId: WorktreeId,
  filePath: string,
  fragment: AnalysisFragment,
): void {
  store.applyOverlaySlice(worktreeId, fragmentToSlice(filePath, fragment));
}

export function removeOverlayFile(
  store: OverlayStore,
  worktreeId: WorktreeId,
  filePath: string,
): void {
  store.markOverlayDeleted(worktreeId, filePath);
}
