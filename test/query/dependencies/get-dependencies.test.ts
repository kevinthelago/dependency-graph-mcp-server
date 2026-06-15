import { describe, it, expect } from "vitest";
import { DirectedGraph } from "graphology";
import type { NodeAttrs, EdgeAttrs } from "../../../src/graph/model.js";
import { createGraphView, type GraphView } from "../../../src/graph/store.js";
import { fileId, symbolId, externalId } from "../../../src/graph/node-id.js";
import {
  getDependencies,
  type GetDependenciesInput,
} from "../../../src/server/tools/get-dependencies.js";
import { forwardBfs } from "../../../src/query/traverse.js";
import { resolveTarget, parseStringTarget } from "../../../src/query/resolver.js";
import type { ToolContext } from "../../../src/query/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGraph(
  nodes: { id: string; attrs: NodeAttrs }[],
  edges: { source: string; target: string; attrs?: EdgeAttrs }[],
): GraphView {
  const g = new DirectedGraph<NodeAttrs, EdgeAttrs>();
  for (const n of nodes) g.addNode(n.id, n.attrs);
  for (const e of edges) {
    g.addEdge(e.source, e.target, e.attrs ?? { kind: "imports" });
  }
  return createGraphView(g);
}

function ctx(view: GraphView, worktreeId = "wt-test"): ToolContext {
  return { worktreeId, view };
}

function run(
  input: Partial<GetDependenciesInput> & { target: string },
  view: GraphView,
) {
  return getDependencies(
    { depth: 1, limit: 500, includePaths: false, ...input },
    ctx(view),
  );
}

// ---------------------------------------------------------------------------
// Shared node ids and attrs
// ---------------------------------------------------------------------------

const FILE_A = fileId("/repo/src/a.ts");
const FILE_B = fileId("/repo/src/b.ts");
const FILE_C = fileId("/repo/src/c.ts");
const EXT = externalId("lodash");
const SYM_FOO = symbolId("/repo/src/a.ts", "foo");

const ATTRS: Record<string, NodeAttrs> = {
  [FILE_A]: { kind: "file", filePath: "/repo/src/a.ts", displayName: "a.ts" },
  [FILE_B]: { kind: "file", filePath: "/repo/src/b.ts", displayName: "b.ts" },
  [FILE_C]: { kind: "file", filePath: "/repo/src/c.ts", displayName: "c.ts" },
  [EXT]: { kind: "external", packageName: "lodash", displayName: "lodash" },
  [SYM_FOO]: {
    kind: "symbol",
    filePath: "/repo/src/a.ts",
    symbolName: "foo",
    displayName: "foo",
  },
};

// ---------------------------------------------------------------------------
// resolveTarget
// ---------------------------------------------------------------------------

describe("resolveTarget", () => {
  const view = buildGraph(
    [FILE_A, FILE_B, SYM_FOO].map((id) => ({ id, attrs: ATTRS[id]! })),
    [],
  );

  it("resolves by raw node id", () => {
    const r = resolveTarget(view, parseStringTarget(FILE_A));
    expect(r).toMatchObject({ id: FILE_A });
  });

  it("returns notFound for unknown node id", () => {
    const r = resolveTarget(view, parseStringTarget("file:/repo/src/missing.ts"));
    expect('notFound' in r).toBe(true);
  });

  it("resolves by file path suffix", () => {
    const r = resolveTarget(view, parseStringTarget("src/a.ts"));
    expect(r).toMatchObject({ id: FILE_A });
  });

  it("resolves path#symbol shorthand", () => {
    const r = resolveTarget(view, parseStringTarget("/repo/src/a.ts#foo"));
    expect(r).toMatchObject({ id: SYM_FOO });
  });

  it("returns notFound for unknown symbol", () => {
    const r = resolveTarget(view, parseStringTarget("/repo/src/a.ts#bar"));
    expect('notFound' in r).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// forwardBfs
// ---------------------------------------------------------------------------

describe("forwardBfs", () => {
  it("depth=1 returns direct dependencies only", () => {
    const view = buildGraph(
      [FILE_A, FILE_B, FILE_C].map((id) => ({ id, attrs: ATTRS[id]! })),
      [
        { source: FILE_A, target: FILE_B },
        { source: FILE_B, target: FILE_C },
      ],
    );
    const { entries } = forwardBfs(view, FILE_A, { maxDepth: 1 });
    const ids = entries.map((e) => e.id);
    expect(ids).toContain(FILE_B);
    expect(ids).not.toContain(FILE_C);
  });

  it("depth=2 returns transitive dependencies", () => {
    const view = buildGraph(
      [FILE_A, FILE_B, FILE_C].map((id) => ({ id, attrs: ATTRS[id]! })),
      [
        { source: FILE_A, target: FILE_B },
        { source: FILE_B, target: FILE_C },
      ],
    );
    const { entries } = forwardBfs(view, FILE_A, { maxDepth: 2 });
    const ids = entries.map((e) => e.id);
    expect(ids).toContain(FILE_C);
  });

  it("collects external nodes but does not traverse into them", () => {
    const view = buildGraph(
      [FILE_A, EXT].map((id) => ({ id, attrs: ATTRS[id]! })),
      [{ source: FILE_A, target: EXT }],
    );
    const { entries } = forwardBfs(view, FILE_A, { maxDepth: 5 });
    const ids = entries.map((e) => e.id);
    expect(ids).toContain(EXT);
    expect(entries.find((e) => e.id === EXT)?.kind).toBe("external");
  });

  it("returns empty result when no outgoing edges", () => {
    const view = buildGraph(
      [{ id: FILE_A, attrs: ATTRS[FILE_A]! }],
      [],
    );
    const { entries } = forwardBfs(view, FILE_A, { maxDepth: 1 });
    expect(entries).toHaveLength(0);
  });

  it("does not visit the same node twice in a cyclic graph", () => {
    const view = buildGraph(
      [FILE_A, FILE_B].map((id) => ({ id, attrs: ATTRS[id]! })),
      [
        { source: FILE_A, target: FILE_B },
        { source: FILE_B, target: FILE_A },
      ],
    );
    const { entries } = forwardBfs(view, FILE_A, { maxDepth: 10 });
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("truncates at limit and sets truncated=true", () => {
    const nodes = Array.from({ length: 600 }, (_, i) => {
      const id = fileId(`/repo/src/dep${i}.ts`);
      return { id, attrs: { kind: "file" as const, filePath: `/repo/src/dep${i}.ts`, displayName: `dep${i}.ts` } };
    });
    const root = { id: FILE_A, attrs: ATTRS[FILE_A]! };
    const view = buildGraph(
      [root, ...nodes],
      nodes.map((n) => ({ source: FILE_A, target: n.id })),
    );
    const result = forwardBfs(view, FILE_A, { maxDepth: 1, limit: 500 });
    expect(result.truncated).toBe(true);
    expect(result.entries).toHaveLength(500);
    expect(result.total).toBeGreaterThan(500);
  });

  it("includePaths populates examplePath on each entry", () => {
    const view = buildGraph(
      [FILE_A, FILE_B, FILE_C].map((id) => ({ id, attrs: ATTRS[id]! })),
      [
        { source: FILE_A, target: FILE_B },
        { source: FILE_B, target: FILE_C },
      ],
    );
    const { entries } = forwardBfs(view, FILE_A, { maxDepth: 2, includePaths: true });
    for (const e of entries) {
      expect(e.examplePath).toBeDefined();
      expect(e.examplePath![0]).toBe(FILE_A);
      expect(e.examplePath![e.examplePath!.length - 1]).toBe(e.id);
    }
  });
});

// ---------------------------------------------------------------------------
// getDependencies tool
// ---------------------------------------------------------------------------

describe("get_dependencies tool", () => {
  it("returns found:false for unknown target", async () => {
    const view = buildGraph(
      [{ id: FILE_A, attrs: ATTRS[FILE_A]! }],
      [],
    );
    const result = await run({ target: "/repo/src/missing.ts" }, view);
    expect(result).toMatchObject({ found: false });
  });

  it("direct dependencies (depth=1)", async () => {
    const view = buildGraph(
      [FILE_A, FILE_B, FILE_C].map((id) => ({ id, attrs: ATTRS[id]! })),
      [
        { source: FILE_A, target: FILE_B },
        { source: FILE_B, target: FILE_C },
      ],
    );
    const result = await run({ target: FILE_A, depth: 1 }, view);
    if ("found" in result) throw new Error("expected success");
    expect(result.targetId).toBe(FILE_A);
    expect(result.dependencies.map((d) => d.id)).toEqual([FILE_B]);
    expect(result.dependencies[0]?.distance).toBe(1);
  });

  it("transitive dependencies (depth=2)", async () => {
    const view = buildGraph(
      [FILE_A, FILE_B, FILE_C].map((id) => ({ id, attrs: ATTRS[id]! })),
      [
        { source: FILE_A, target: FILE_B },
        { source: FILE_B, target: FILE_C },
      ],
    );
    const result = await run({ target: FILE_A, depth: 2 }, view);
    if ("found" in result) throw new Error("expected success");
    const ids = result.dependencies.map((d) => d.id);
    expect(ids).toContain(FILE_B);
    expect(ids).toContain(FILE_C);
  });

  it("external leaf is included but not traversed further", async () => {
    const view = buildGraph(
      [FILE_A, EXT].map((id) => ({ id, attrs: ATTRS[id]! })),
      [{ source: FILE_A, target: EXT }],
    );
    const result = await run({ target: FILE_A, depth: 5 }, view);
    if ("found" in result) throw new Error("expected success");
    expect(result.dependencies.some((d) => d.id === EXT)).toBe(true);
    expect(result.dependencies.find((d) => d.id === EXT)?.kind).toBe("external");
  });

  it("empty result when no outgoing edges", async () => {
    const view = buildGraph(
      [{ id: FILE_A, attrs: ATTRS[FILE_A]! }],
      [],
    );
    const result = await run({ target: FILE_A }, view);
    if ("found" in result) throw new Error("expected success");
    expect(result.dependencies).toHaveLength(0);
    expect(result.truncated).toBe(false);
    expect(result.total).toBe(0);
  });

  it("truncates large results and sets truncated=true", async () => {
    const nodes = Array.from({ length: 600 }, (_, i) => {
      const id = fileId(`/repo/src/dep${i}.ts`);
      return { id, attrs: { kind: "file" as const, filePath: `/repo/src/dep${i}.ts`, displayName: `dep${i}.ts` } };
    });
    const root = { id: FILE_A, attrs: ATTRS[FILE_A]! };
    const view = buildGraph(
      [root, ...nodes],
      nodes.map((n) => ({ source: FILE_A, target: n.id })),
    );
    const result = await run({ target: FILE_A, depth: 1, limit: 500 }, view);
    if ("found" in result) throw new Error("expected success");
    expect(result.truncated).toBe(true);
    expect(result.dependencies).toHaveLength(500);
    expect(result.total).toBeGreaterThan(500);
  });

  it("resolves by file path suffix", async () => {
    const view = buildGraph(
      [FILE_A, FILE_B].map((id) => ({ id, attrs: ATTRS[id]! })),
      [{ source: FILE_A, target: FILE_B }],
    );
    const result = await run({ target: "src/a.ts", depth: 1 }, view);
    if ("found" in result) throw new Error("expected success");
    expect(result.targetId).toBe(FILE_A);
  });

  it("returns distance on each dependency entry", async () => {
    const view = buildGraph(
      [FILE_A, FILE_B, FILE_C].map((id) => ({ id, attrs: ATTRS[id]! })),
      [
        { source: FILE_A, target: FILE_B },
        { source: FILE_B, target: FILE_C },
      ],
    );
    const result = await run({ target: FILE_A, depth: 2 }, view);
    if ("found" in result) throw new Error("expected success");
    const b = result.dependencies.find((d) => d.id === FILE_B);
    const c = result.dependencies.find((d) => d.id === FILE_C);
    expect(b?.distance).toBe(1);
    expect(c?.distance).toBe(2);
  });

  it("includePaths populates examplePath on each entry", async () => {
    const view = buildGraph(
      [FILE_A, FILE_B].map((id) => ({ id, attrs: ATTRS[id]! })),
      [{ source: FILE_A, target: FILE_B }],
    );
    const result = await run({ target: FILE_A, depth: 1, includePaths: true }, view);
    if ("found" in result) throw new Error("expected success");
    expect(result.dependencies[0]?.examplePath).toBeDefined();
    expect(result.dependencies[0]?.examplePath![0]).toBe(FILE_A);
  });
});
