import { describe, it, expect } from "vitest";
import { DirectedGraph } from "graphology";
import type { NodeAttrs, EdgeAttrs } from "../../../src/graph/model.js";
import { createGraphView } from "../../../src/graph/store.js";
import { fileId, symbolId } from "../../../src/graph/node-id.js";
import {
  detectCycles,
  type DetectCyclesInput,
  type CycleGroup,
} from "../../../src/server/tools/detect-cycles.js";
import type { ToolContext } from "../../../src/query/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Creates a DirectedGraph that supports self-loops for cycle testing. */
function makeGraph() {
  return new DirectedGraph<NodeAttrs, EdgeAttrs>({ allowSelfLoops: true });
}

function mkCtx(
  nodes: { id: string; kind: "file" | "symbol" | "external"; name: string; file?: string }[],
  edges: { from: string; to: string }[],
  worktreeId = "wt-test",
): ToolContext {
  const g = makeGraph();
  for (const n of nodes) {
    if (n.kind === "file") {
      g.addNode(n.id, { kind: "file", filePath: n.name, displayName: n.name });
    } else if (n.kind === "symbol") {
      g.addNode(n.id, {
        kind: "symbol",
        filePath: n.file ?? "",
        symbolName: n.name,
        displayName: n.name,
      });
    } else {
      g.addNode(n.id, { kind: "external", packageName: n.name, displayName: n.name });
    }
  }
  for (const e of edges) {
    g.addDirectedEdge(e.from, e.to, { kind: "imports" });
  }
  return { worktreeId, view: createGraphView(g) };
}

function run(
  input: Partial<DetectCyclesInput>,
  ctx: ToolContext,
): ReturnType<typeof detectCycles> {
  return detectCycles({ granularity: "module", maxGroupSize: 50, ...input }, ctx);
}

/** Sort groups for stable comparison in tests. */
function sortedGroups(groups: CycleGroup[]): CycleGroup[] {
  return groups
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Shared file node IDs
// ---------------------------------------------------------------------------

const A = fileId("src/a.ts");
const B = fileId("src/b.ts");
const C = fileId("src/c.ts");
const D = fileId("src/d.ts");
const LIB = fileId("lib/helper.ts");

const FILE_A = { id: A, kind: "file" as const, name: "src/a.ts" };
const FILE_B = { id: B, kind: "file" as const, name: "src/b.ts" };
const FILE_C = { id: C, kind: "file" as const, name: "src/c.ts" };
const FILE_D = { id: D, kind: "file" as const, name: "src/d.ts" };
const FILE_LIB = { id: LIB, kind: "file" as const, name: "lib/helper.ts" };

// ---------------------------------------------------------------------------
// No-cycle cases
// ---------------------------------------------------------------------------

describe("detect_cycles – no cycle", () => {
  it("returns empty groups for an empty graph", () => {
    const ctx = mkCtx([], []);
    const result = run({}, ctx);
    expect(result.groups).toHaveLength(0);
    expect(result.truncated).toBe(false);
    expect(result.totalGroups).toBe(0);
  });

  it("returns empty groups for an isolated node", () => {
    const ctx = mkCtx([FILE_A], []);
    const result = run({}, ctx);
    expect(result.groups).toHaveLength(0);
  });

  it("returns empty groups for a simple DAG (A→B→C)", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_C],
      [
        { from: A, to: B },
        { from: B, to: C },
      ],
    );
    const result = run({}, ctx);
    expect(result.groups).toHaveLength(0);
  });

  it("returns empty groups for a DAG with a diamond (A→B, A→C, B→D, C→D)", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_C, FILE_D],
      [
        { from: A, to: B },
        { from: A, to: C },
        { from: B, to: D },
        { from: C, to: D },
      ],
    );
    const result = run({}, ctx);
    expect(result.groups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2-node cycle
// ---------------------------------------------------------------------------

describe("detect_cycles – 2-node cycle", () => {
  it("finds a mutual-import cycle (A↔B)", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B],
      [
        { from: A, to: B },
        { from: B, to: A },
      ],
    );
    const result = run({}, ctx);
    expect(result.totalGroups).toBe(1);
    expect(result.groups).toHaveLength(1);

    const group = result.groups[0]!;
    expect(group.size).toBe(2);
    expect(group.nodes.slice().sort()).toEqual([A, B].sort());
    expect(group.truncated).toBe(false);
  });

  it("example cycle path for 2-node cycle starts and ends at the same node", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B],
      [
        { from: A, to: B },
        { from: B, to: A },
      ],
    );
    const result = run({}, ctx);
    const path = result.groups[0]!.exampleCyclePath;
    expect(path.length).toBeGreaterThanOrEqual(3); // [start, …, start]
    expect(path[0]).toBe(path[path.length - 1]); // closes the loop
  });

  it("example path nodes are all in the cycle group", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B],
      [
        { from: A, to: B },
        { from: B, to: A },
      ],
    );
    const result = run({}, ctx);
    const group = result.groups[0]!;
    const groupSet = new Set(group.nodes);
    // All path nodes except the closing duplicate must be in the group
    for (const n of group.exampleCyclePath.slice(0, -1)) {
      expect(groupSet.has(n)).toBe(true);
    }
  });

  it("does not duplicate a node that has both in and out edges without a cycle", () => {
    // A→B→C: no cycle; B has both in (A) and out (C) edges
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_C],
      [
        { from: A, to: B },
        { from: B, to: C },
      ],
    );
    const result = run({}, ctx);
    expect(result.groups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Larger SCC (3+ nodes)
// ---------------------------------------------------------------------------

describe("detect_cycles – larger SCC", () => {
  it("finds a 3-node cycle (A→B→C→A)", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_C],
      [
        { from: A, to: B },
        { from: B, to: C },
        { from: C, to: A },
      ],
    );
    const result = run({}, ctx);
    expect(result.totalGroups).toBe(1);
    expect(result.groups[0]!.size).toBe(3);
    expect(result.groups[0]!.nodes.slice().sort()).toEqual([A, B, C].sort());
  });

  it("example path for 3-node cycle is a valid cycle", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_C],
      [
        { from: A, to: B },
        { from: B, to: C },
        { from: C, to: A },
      ],
    );
    const result = run({}, ctx);
    const path = result.groups[0]!.exampleCyclePath;
    expect(path.length).toBeGreaterThanOrEqual(4); // at least [a, b, c, a]
    expect(path[0]).toBe(path[path.length - 1]);   // closes the loop
  });

  it("finds two independent 2-node cycles", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_C, FILE_D],
      [
        { from: A, to: B },
        { from: B, to: A }, // cycle 1
        { from: C, to: D },
        { from: D, to: C }, // cycle 2
      ],
    );
    const result = run({}, ctx);
    expect(result.totalGroups).toBe(2);
    expect(result.groups).toHaveLength(2);

    const sizes = result.groups.map((g) => g.size).sort();
    expect(sizes).toEqual([2, 2]);
  });

  it("reports correct size when SCC overlaps multiple entry points", () => {
    // A→B, B→C, C→A, A→C (extra edge — still one SCC of 3)
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_C],
      [
        { from: A, to: B },
        { from: B, to: C },
        { from: C, to: A },
        { from: A, to: C },
      ],
    );
    const result = run({}, ctx);
    expect(result.totalGroups).toBe(1);
    expect(result.groups[0]!.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Self-loop
// ---------------------------------------------------------------------------

describe("detect_cycles – self-loop", () => {
  it("detects a self-loop (A→A)", () => {
    const ctx = mkCtx([FILE_A], [{ from: A, to: A }]);
    const result = run({}, ctx);
    expect(result.totalGroups).toBe(1);
    const group = result.groups[0]!;
    expect(group.size).toBe(1);
    expect(group.nodes).toEqual([A]);
  });

  it("exampleCyclePath for self-loop is [node, node]", () => {
    const ctx = mkCtx([FILE_A], [{ from: A, to: A }]);
    const result = run({}, ctx);
    expect(result.groups[0]!.exampleCyclePath).toEqual([A, A]);
  });

  it("does not report a node without a self-loop as a cycle", () => {
    // A has an outgoing edge to B but no self-loop
    const ctx = mkCtx([FILE_A, FILE_B], [{ from: A, to: B }]);
    const result = run({}, ctx);
    expect(result.groups).toHaveLength(0);
  });

  it("finds both a self-loop and a multi-node cycle", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_C],
      [
        { from: A, to: A }, // self-loop
        { from: B, to: C },
        { from: C, to: B }, // 2-node cycle
      ],
    );
    const result = run({}, ctx);
    expect(result.totalGroups).toBe(2);

    const selfLoopGroup = result.groups.find((g) => g.size === 1);
    const cycleGroup = result.groups.find((g) => g.size === 2);

    expect(selfLoopGroup).toBeDefined();
    expect(selfLoopGroup!.nodes).toEqual([A]);
    expect(cycleGroup).toBeDefined();
    expect(cycleGroup!.nodes.slice().sort()).toEqual([B, C].sort());
  });
});

// ---------------------------------------------------------------------------
// Scope filter
// ---------------------------------------------------------------------------

describe("detect_cycles – scope filter", () => {
  it("only includes nodes within the scope prefix", () => {
    // Cycle in src/: A↔B. Cycle in lib/: LIB self-loop.
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_LIB],
      [
        { from: A, to: B },
        { from: B, to: A },
        { from: LIB, to: LIB },
      ],
    );
    const result = run({ scope: "src/" }, ctx);
    // Only the src/ cycle should appear
    expect(result.totalGroups).toBe(1);
    const group = result.groups[0]!;
    expect(group.nodes.every((n) => n.startsWith("file:src/"))).toBe(true);
  });

  it("excludes cycles entirely outside the scope", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_LIB],
      [
        { from: A, to: B },
        { from: B, to: A },
        { from: LIB, to: LIB },
      ],
    );
    // Scope to lib/ — only the self-loop on LIB should appear
    const result = run({ scope: "lib/" }, ctx);
    expect(result.totalGroups).toBe(1);
    expect(result.groups[0]!.nodes).toEqual([LIB]);
  });

  it("returns no cycles when scope matches no nodes", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B],
      [
        { from: A, to: B },
        { from: B, to: A },
      ],
    );
    const result = run({ scope: "nonexistent/" }, ctx);
    expect(result.totalGroups).toBe(0);
  });

  it("scope breaks a cross-boundary cycle into no result", () => {
    // A (src/) → LIB (lib/) → A: cycle only visible when both nodes included
    const ctx = mkCtx(
      [FILE_A, FILE_LIB],
      [
        { from: A, to: LIB },
        { from: LIB, to: A },
      ],
    );
    // Scoped to src/: LIB is excluded, so A has no successors within scope
    const result = run({ scope: "src/" }, ctx);
    expect(result.totalGroups).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Module vs symbol granularity
// ---------------------------------------------------------------------------

describe("detect_cycles – module vs symbol granularity", () => {
  const SYM_A = symbolId("src/a.ts", "funcA");
  const SYM_B = symbolId("src/b.ts", "funcB");

  function mkMixedCtx(): ToolContext {
    // File-level: A → B (one direction only — no file-level cycle)
    // Symbol-level: funcA → funcB → funcA (symbol cycle)
    return mkCtx(
      [
        FILE_A,
        FILE_B,
        { id: SYM_A, kind: "symbol", name: "funcA", file: "src/a.ts" },
        { id: SYM_B, kind: "symbol", name: "funcB", file: "src/b.ts" },
      ],
      [
        { from: A, to: B },      // file import (A depends on B, not cyclic)
        { from: SYM_A, to: SYM_B }, // symbol reference
        { from: SYM_B, to: SYM_A }, // symbol reference back (forms a cycle)
      ],
    );
  }

  it("module mode includes only file nodes and misses symbol-only cycles", () => {
    const ctx = mkMixedCtx();
    const result = run({ granularity: "module" }, ctx);
    // No file-level cycle (A→B only, no reverse), so no cycle groups
    expect(result.totalGroups).toBe(0);
  });

  it("symbol mode includes both file and symbol nodes", () => {
    const ctx = mkMixedCtx();
    const result = run({ granularity: "symbol" }, ctx);
    // Symbol cycle should be found
    expect(result.totalGroups).toBe(1);
    const group = result.groups[0]!;
    expect(group.nodes.slice().sort()).toEqual([SYM_A, SYM_B].sort());
  });

  it("symbol mode also finds file-level cycles when they exist", () => {
    // Both file cycle and symbol cycle
    const ctx = mkCtx(
      [
        FILE_A,
        FILE_B,
        { id: SYM_A, kind: "symbol", name: "funcA", file: "src/a.ts" },
        { id: SYM_B, kind: "symbol", name: "funcB", file: "src/b.ts" },
      ],
      [
        { from: A, to: B },
        { from: B, to: A }, // file cycle
        { from: SYM_A, to: SYM_B },
        { from: SYM_B, to: SYM_A }, // symbol cycle
      ],
    );
    const result = run({ granularity: "symbol" }, ctx);
    expect(result.totalGroups).toBe(2);
  });

  it("module mode skips symbol nodes even when they form a cycle", () => {
    const ctx = mkCtx(
      [
        { id: SYM_A, kind: "symbol", name: "funcA", file: "src/a.ts" },
        { id: SYM_B, kind: "symbol", name: "funcB", file: "src/b.ts" },
      ],
      [
        { from: SYM_A, to: SYM_B },
        { from: SYM_B, to: SYM_A },
      ],
    );
    const result = run({ granularity: "module" }, ctx);
    expect(result.totalGroups).toBe(0);
  });

  it("module mode excludes external nodes", () => {
    const EXT = "ext:ts:lodash";
    const g = makeGraph();
    g.addNode(A, { kind: "file", filePath: "src/a.ts", displayName: "src/a.ts" });
    g.addNode(EXT, { kind: "external", packageName: "lodash", displayName: "lodash" });
    // Even if A imports and re-exports ext (which is impossible in practice),
    // external nodes must be filtered out
    g.addDirectedEdge(A, EXT, { kind: "imports" });
    g.addDirectedEdge(EXT, A, { kind: "imports" });
    const ctx: ToolContext = { worktreeId: "wt-test", view: createGraphView(g) };
    const result = run({ granularity: "module" }, ctx);
    expect(result.totalGroups).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("detect_cycles – determinism", () => {
  it("groups are sorted larger-first, then by min node id", () => {
    // Two cycles: 3-node (A,B,C) and 2-node (D and a new node E)
    const E = fileId("src/e.ts");
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_C, FILE_D, { id: E, kind: "file", name: "src/e.ts" }],
      [
        { from: A, to: B },
        { from: B, to: C },
        { from: C, to: A }, // 3-node
        { from: D, to: E },
        { from: E, to: D }, // 2-node
      ],
    );
    const result = run({}, ctx);
    expect(result.groups).toHaveLength(2);
    // Larger group first
    expect(result.groups[0]!.size).toBe(3);
    expect(result.groups[1]!.size).toBe(2);
  });

  it("nodes within each group are sorted lexicographically", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_C],
      [
        { from: A, to: B },
        { from: B, to: C },
        { from: C, to: A },
      ],
    );
    const result = run({}, ctx);
    const nodes = result.groups[0]!.nodes;
    const sorted = nodes.slice().sort();
    expect(nodes).toEqual(sorted);
  });

  it("group IDs are stable across identical graph inputs", () => {
    const ctx1 = mkCtx(
      [FILE_A, FILE_B],
      [
        { from: A, to: B },
        { from: B, to: A },
      ],
    );
    const ctx2 = mkCtx(
      [FILE_A, FILE_B],
      [
        { from: A, to: B },
        { from: B, to: A },
      ],
    );
    const r1 = run({}, ctx1);
    const r2 = run({}, ctx2);
    expect(r1.groups[0]!.id).toBe(r2.groups[0]!.id);
  });
});

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

describe("detect_cycles – truncation", () => {
  it("group truncated=false when SCC size <= maxGroupSize", () => {
    const ctx = mkCtx(
      [FILE_A, FILE_B, FILE_C],
      [
        { from: A, to: B },
        { from: B, to: C },
        { from: C, to: A },
      ],
    );
    const result = run({ maxGroupSize: 10 }, ctx);
    expect(result.groups[0]!.truncated).toBe(false);
    expect(result.groups[0]!.nodes).toHaveLength(3);
  });

  it("group truncated=true when SCC size > maxGroupSize", () => {
    // Build a cycle of 5 nodes with maxGroupSize=3
    const ids = Array.from({ length: 5 }, (_, i) => fileId(`src/node${i}.ts`));
    const g = makeGraph();
    for (const id of ids) {
      g.addNode(id, { kind: "file", filePath: id.slice(5), displayName: id.slice(5) });
    }
    // Chain them into a single cycle
    for (let i = 0; i < ids.length; i++) {
      const from = ids[i]!;
      const to = ids[(i + 1) % ids.length]!;
      g.addDirectedEdge(from, to, { kind: "imports" });
    }
    const ctx: ToolContext = { worktreeId: "wt", view: createGraphView(g) };
    const result = run({ maxGroupSize: 3 }, ctx);

    const group = result.groups[0]!;
    expect(group.size).toBe(5);
    expect(group.nodes).toHaveLength(3); // capped
    expect(group.truncated).toBe(true);
  });

  it("size reflects total SCC count even when nodes are truncated", () => {
    const ids = Array.from({ length: 10 }, (_, i) => fileId(`src/n${i}.ts`));
    const g = makeGraph();
    for (const id of ids) {
      g.addNode(id, { kind: "file", filePath: id.slice(5), displayName: id.slice(5) });
    }
    for (let i = 0; i < ids.length; i++) {
      const from = ids[i]!;
      const to = ids[(i + 1) % ids.length]!;
      g.addDirectedEdge(from, to, { kind: "imports" });
    }
    const ctx: ToolContext = { worktreeId: "wt", view: createGraphView(g) };
    const result = run({ maxGroupSize: 5 }, ctx);

    const group = result.groups[0]!;
    expect(group.size).toBe(10);
    expect(group.nodes).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// worktreeId scoping
// ---------------------------------------------------------------------------

describe("detect_cycles – worktreeId scoping", () => {
  it("honours the worktreeId from ToolContext", () => {
    // Different context objects with different views
    const ctxWithCycle = mkCtx(
      [FILE_A, FILE_B],
      [
        { from: A, to: B },
        { from: B, to: A },
      ],
      "wt-with-cycle",
    );
    const ctxNoCycle = mkCtx(
      [FILE_A, FILE_B],
      [{ from: A, to: B }],
      "wt-no-cycle",
    );
    expect(run({}, ctxWithCycle).totalGroups).toBe(1);
    expect(run({}, ctxNoCycle).totalGroups).toBe(0);
  });
});
