import { describe, it, expect } from "vitest";
import { DirectedGraph } from "graphology";
import type { NodeAttrs, EdgeAttrs } from "../../../src/graph/model.js";
import { createGraphView, type GraphView } from "../../../src/graph/store.js";
import { fileId, symbolId } from "../../../src/graph/node-id.js";
import {
  getBlastRadius,
  type GetBlastRadiusInput,
} from "../../../src/server/tools/get-blast-radius.js";
import type { ToolContext } from "../../../src/query/types.js";

// ---------------------------------------------------------------------------
// Test graph builder helpers
// ---------------------------------------------------------------------------

function buildGraph(
  nodes: { id: string; attrs: NodeAttrs }[],
  edges: { source: string; target: string; attrs?: EdgeAttrs }[]
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

function run(input: Partial<GetBlastRadiusInput> & { target: string }, view: GraphView) {
  return getBlastRadius(
    { rollUp: false, includePaths: false, ...input } as GetBlastRadiusInput,
    ctx(view)
  );
}

// ---------------------------------------------------------------------------
// Shared node ids
// ---------------------------------------------------------------------------

const CORE = fileId("/repo/src/core.ts");
const UTILS = fileId("/repo/src/utils.ts");
const SERVICE = fileId("/repo/src/service.ts");
const APP = fileId("/repo/src/app.ts");
const MAIN = fileId("/repo/src/main.ts");

const CORE_ATTRS: NodeAttrs = { kind: "file", filePath: "/repo/src/core.ts", displayName: "core.ts" };
const UTILS_ATTRS: NodeAttrs = { kind: "file", filePath: "/repo/src/utils.ts", displayName: "utils.ts" };
const SERVICE_ATTRS: NodeAttrs = { kind: "file", filePath: "/repo/src/service.ts", displayName: "service.ts" };
const APP_ATTRS: NodeAttrs = { kind: "file", filePath: "/repo/src/app.ts", displayName: "app.ts" };
const MAIN_ATTRS: NodeAttrs = { kind: "file", filePath: "/repo/src/main.ts", displayName: "main.ts" };

// ---------------------------------------------------------------------------
// Tests: direct dependents only
// ---------------------------------------------------------------------------

describe("get_blast_radius – direct dependents (depth 1)", () => {
  it("returns the single direct importer of a file", async () => {
    //  utils → core  (utils imports core)
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: UTILS, attrs: UTILS_ATTRS },
      ],
      [{ source: UTILS, target: CORE }]
    );

    const result = await run({ target: CORE }, view);

    expect(result.targetId).toBe(CORE);
    expect(result.safeToChange).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.dependents).toHaveLength(1);
    expect(result.dependents[0]?.id).toBe(UTILS);
    expect(result.dependents[0]?.distance).toBe(1);
  });

  it("returns multiple direct importers", async () => {
    //  utils → core,  service → core
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: UTILS, attrs: UTILS_ATTRS },
        { id: SERVICE, attrs: SERVICE_ATTRS },
      ],
      [
        { source: UTILS, target: CORE },
        { source: SERVICE, target: CORE },
      ]
    );

    const result = await run({ target: CORE }, view);
    const ids = result.dependents.map((d) => d.id).sort();
    expect(ids).toEqual([SERVICE, UTILS].sort());
    expect(result.dependents.every((d) => d.distance === 1)).toBe(true);
  });

  it("limits to depth 1 when maxDepth=1", async () => {
    //  main → app → service → core
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: SERVICE, attrs: SERVICE_ATTRS },
        { id: APP, attrs: APP_ATTRS },
        { id: MAIN, attrs: MAIN_ATTRS },
      ],
      [
        { source: SERVICE, target: CORE },
        { source: APP, target: SERVICE },
        { source: MAIN, target: APP },
      ]
    );

    const result = await run({ target: CORE, maxDepth: 1 }, view);
    expect(result.dependents).toHaveLength(1);
    expect(result.dependents[0]?.id).toBe(SERVICE);
    expect(result.dependents[0]?.distance).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: deep / transitive dependents
// ---------------------------------------------------------------------------

describe("get_blast_radius – deep transitive dependents", () => {
  it("finds transitive dependents at correct distances", async () => {
    //  main(3) → app(2) → service(1) → core(target)
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: SERVICE, attrs: SERVICE_ATTRS },
        { id: APP, attrs: APP_ATTRS },
        { id: MAIN, attrs: MAIN_ATTRS },
      ],
      [
        { source: SERVICE, target: CORE },
        { source: APP, target: SERVICE },
        { source: MAIN, target: APP },
      ]
    );

    const result = await run({ target: CORE }, view);
    const byId = Object.fromEntries(result.dependents.map((d) => [d.id, d]));

    expect(byId[SERVICE]?.distance).toBe(1);
    expect(byId[APP]?.distance).toBe(2);
    expect(byId[MAIN]?.distance).toBe(3);
    expect(result.dependents).toHaveLength(3);
  });

  it("assigns shortest distance when multiple paths exist", async () => {
    //  app → service → core  AND  app → core  (app has distance 1 to core)
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: SERVICE, attrs: SERVICE_ATTRS },
        { id: APP, attrs: APP_ATTRS },
      ],
      [
        { source: SERVICE, target: CORE },
        { source: APP, target: SERVICE },
        { source: APP, target: CORE },  // direct too
      ]
    );

    const result = await run({ target: CORE }, view);
    const byId = Object.fromEntries(result.dependents.map((d) => [d.id, d]));

    // service is distance 1, app is distance 1 (direct), not 2
    expect(byId[SERVICE]?.distance).toBe(1);
    expect(byId[APP]?.distance).toBe(1);
  });

  it("limits depth when maxDepth=2", async () => {
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: SERVICE, attrs: SERVICE_ATTRS },
        { id: APP, attrs: APP_ATTRS },
        { id: MAIN, attrs: MAIN_ATTRS },
      ],
      [
        { source: SERVICE, target: CORE },
        { source: APP, target: SERVICE },
        { source: MAIN, target: APP },
      ]
    );

    const result = await run({ target: CORE, maxDepth: 2 }, view);
    const ids = result.dependents.map((d) => d.id).sort();
    expect(ids).toEqual([APP, SERVICE].sort());
    // MAIN is at distance 3, beyond maxDepth
  });
});

// ---------------------------------------------------------------------------
// Tests: symbol vs file targeting
// ---------------------------------------------------------------------------

describe("get_blast_radius – symbol-vs-file targeting", () => {
  const SYM_CORE_FOO = symbolId("/repo/src/core.ts", "Foo");
  const SYM_CORE_FOO_ATTRS: NodeAttrs = {
    kind: "symbol",
    filePath: "/repo/src/core.ts",
    symbolName: "Foo",
    displayName: "Foo",
  };

  it("can target a symbol node directly and find its importers", async () => {
    //  utils imports the Foo symbol from core
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: SYM_CORE_FOO, attrs: SYM_CORE_FOO_ATTRS },
        { id: UTILS, attrs: UTILS_ATTRS },
      ],
      [{ source: UTILS, target: SYM_CORE_FOO }]
    );

    const result = await run({ target: SYM_CORE_FOO }, view);
    expect(result.targetId).toBe(SYM_CORE_FOO);
    expect(result.dependents).toHaveLength(1);
    expect(result.dependents[0]?.id).toBe(UTILS);
  });

  it("resolves 'file.ts#Symbol' shorthand to a symbol node", async () => {
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: SYM_CORE_FOO, attrs: SYM_CORE_FOO_ATTRS },
        { id: UTILS, attrs: UTILS_ATTRS },
      ],
      [{ source: UTILS, target: SYM_CORE_FOO }]
    );

    // Use shorthand
    const result = await run({ target: "/repo/src/core.ts#Foo" }, view);
    expect(result.targetId).toBe(SYM_CORE_FOO);
    expect(result.dependents).toHaveLength(1);
  });

  it("file-level targeting finds both file importers and symbol importers of that file", async () => {
    //  utils → CORE (file)  AND  service → SYM_CORE_FOO (symbol in same file)
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: SYM_CORE_FOO, attrs: SYM_CORE_FOO_ATTRS },
        { id: UTILS, attrs: UTILS_ATTRS },
        { id: SERVICE, attrs: SERVICE_ATTRS },
      ],
      [
        { source: UTILS, target: CORE },
        { source: SERVICE, target: CORE },
      ]
    );

    const result = await run({ target: CORE }, view);
    const ids = result.dependents.map((d) => d.id).sort();
    expect(ids).toEqual([SERVICE, UTILS].sort());
  });
});

// ---------------------------------------------------------------------------
// Tests: rollUp
// ---------------------------------------------------------------------------

describe("get_blast_radius – rollUp", () => {
  const SYM_UTILS_BAR = symbolId("/repo/src/utils.ts", "Bar");
  const SYM_UTILS_BAR_ATTRS: NodeAttrs = {
    kind: "symbol",
    filePath: "/repo/src/utils.ts",
    symbolName: "Bar",
    displayName: "Bar",
  };
  const CORE_SYM = symbolId("/repo/src/core.ts", "CoreClass");
  const CORE_SYM_ATTRS: NodeAttrs = {
    kind: "symbol",
    filePath: "/repo/src/core.ts",
    symbolName: "CoreClass",
    displayName: "CoreClass",
  };

  it("adds containing file for symbol dependents when rollUp=true", async () => {
    //  SYM_UTILS_BAR → CORE_SYM  (a symbol depends on another symbol)
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: CORE_SYM, attrs: CORE_SYM_ATTRS },
        { id: UTILS, attrs: UTILS_ATTRS },
        { id: SYM_UTILS_BAR, attrs: SYM_UTILS_BAR_ATTRS },
      ],
      [{ source: SYM_UTILS_BAR, target: CORE_SYM }]
    );

    const result = await run(
      { target: CORE_SYM, rollUp: true },
      view
    );

    const ids = result.dependents.map((d) => d.id);
    // SYM_UTILS_BAR is the direct dependent (distance 1)
    expect(ids).toContain(SYM_UTILS_BAR);
    // UTILS (the containing file) should be synthesised
    expect(ids).toContain(UTILS);

    const utilsEntry = result.dependents.find((d) => d.id === UTILS);
    expect(utilsEntry?.rolledUp).toBe(true);
  });

  it("does NOT add containing file when rollUp=false", async () => {
    const view = buildGraph(
      [
        { id: CORE_SYM, attrs: CORE_SYM_ATTRS },
        { id: UTILS, attrs: UTILS_ATTRS },
        { id: SYM_UTILS_BAR, attrs: SYM_UTILS_BAR_ATTRS },
      ],
      [{ source: SYM_UTILS_BAR, target: CORE_SYM }]
    );

    const result = await run(
      { target: CORE_SYM, rollUp: false },
      view
    );

    const ids = result.dependents.map((d) => d.id);
    expect(ids).toContain(SYM_UTILS_BAR);
    expect(ids).not.toContain(UTILS);
  });

  it("does not duplicate file entry when file is already a direct dependent", async () => {
    //  UTILS → CORE (direct file dep)  AND  SYM_UTILS_BAR → CORE_SYM
    const CORE_SYM2 = symbolId("/repo/src/core.ts", "AnotherSym");
    const CORE_SYM2_ATTRS: NodeAttrs = {
      kind: "symbol",
      filePath: "/repo/src/core.ts",
      symbolName: "AnotherSym",
      displayName: "AnotherSym",
    };
    const TARGET = CORE;

    const view = buildGraph(
      [
        { id: TARGET, attrs: CORE_ATTRS },
        { id: CORE_SYM2, attrs: CORE_SYM2_ATTRS },
        { id: UTILS, attrs: UTILS_ATTRS },
        { id: SYM_UTILS_BAR, attrs: SYM_UTILS_BAR_ATTRS },
      ],
      [
        { source: UTILS, target: TARGET },          // UTILS directly imports CORE
        { source: SYM_UTILS_BAR, target: TARGET },  // Bar also imports CORE
      ]
    );

    const result = await run({ target: TARGET, rollUp: true }, view);

    const utilsEntries = result.dependents.filter((d) => d.id === UTILS);
    expect(utilsEntries).toHaveLength(1); // no duplicates
    // The non-rolled-up entry (direct dep) should take precedence
    expect(utilsEntries[0]?.rolledUp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: cycle safety
// ---------------------------------------------------------------------------

describe("get_blast_radius – cycle safety", () => {
  it("handles a direct self-loop without infinite looping", async () => {
    //  core → core (self-import, shouldn't happen but must not blow up)
    const g = new DirectedGraph<NodeAttrs, EdgeAttrs>();
    g.addNode(CORE, CORE_ATTRS);
    g.addEdge(CORE, CORE, { kind: "imports" });
    const view = createGraphView(g);

    const result = await run({ target: CORE }, view);
    // Self-loop: CORE is the target, it's in visited from the start,
    // so it won't appear as a dependent of itself.
    expect(result.dependents).toHaveLength(0);
    expect(result.safeToChange).toBe(true);
  });

  it("handles a mutual cycle (A→B, B→A) targeting A", async () => {
    //  UTILS ↔ SERVICE  (mutual import)  →  target = SERVICE
    const view = buildGraph(
      [
        { id: SERVICE, attrs: SERVICE_ATTRS },
        { id: UTILS, attrs: UTILS_ATTRS },
      ],
      [
        { source: UTILS, target: SERVICE },
        { source: SERVICE, target: UTILS },
      ]
    );

    // Blast radius of SERVICE: UTILS imports SERVICE
    const result = await run({ target: SERVICE }, view);
    // UTILS should appear once at distance 1; SERVICE itself not revisited
    expect(result.dependents).toHaveLength(1);
    expect(result.dependents[0]?.id).toBe(UTILS);
    expect(result.dependents[0]?.distance).toBe(1);
  });

  it("handles a longer cycle (A→B→C→A) targeting B", async () => {
    const A = fileId("/repo/a.ts");
    const B = fileId("/repo/b.ts");
    const C = fileId("/repo/c.ts");
    const AATTR: NodeAttrs = { kind: "file", filePath: "/repo/a.ts", displayName: "a.ts" };
    const BATTR: NodeAttrs = { kind: "file", filePath: "/repo/b.ts", displayName: "b.ts" };
    const CATTR: NodeAttrs = { kind: "file", filePath: "/repo/c.ts", displayName: "c.ts" };

    const view = buildGraph(
      [
        { id: A, attrs: AATTR },
        { id: B, attrs: BATTR },
        { id: C, attrs: CATTR },
      ],
      [
        { source: A, target: B },
        { source: B, target: C },
        { source: C, target: A },
      ]
    );

    // Blast radius of B: A → B, C → A → B (distance 2)
    const result = await run({ target: B }, view);
    const byId = Object.fromEntries(result.dependents.map((d) => [d.id, d]));

    expect(byId[A]?.distance).toBe(1);
    expect(byId[C]?.distance).toBe(2);
    expect(result.dependents).toHaveLength(2); // only 2 unique nodes
  });
});

// ---------------------------------------------------------------------------
// Tests: empty blast radius (safe to change)
// ---------------------------------------------------------------------------

describe("get_blast_radius – empty (safe to change)", () => {
  it("returns safeToChange=true when nothing imports the target", async () => {
    //  core has no in-edges
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: UTILS, attrs: UTILS_ATTRS },
      ],
      [{ source: CORE, target: UTILS }] // core imports utils, not the other way
    );

    const result = await run({ target: CORE }, view);
    expect(result.safeToChange).toBe(true);
    expect(result.dependents).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it("returns safeToChange=true for an isolated node", async () => {
    const view = buildGraph([{ id: CORE, attrs: CORE_ATTRS }], []);
    const result = await run({ target: CORE }, view);
    expect(result.safeToChange).toBe(true);
    expect(result.dependents).toHaveLength(0);
  });

  it("throws when the target node does not exist", async () => {
    const view = buildGraph([], []);
    await expect(run({ target: "file:/repo/nonexistent.ts" }, view)).rejects.toThrow(
      /not found/i
    );
  });

  it("throws when target is ambiguous", async () => {
    //  Two files end in /utils.ts
    const A = fileId("/repo/a/utils.ts");
    const B = fileId("/repo/b/utils.ts");
    const view = buildGraph(
      [
        { id: A, attrs: { kind: "file", filePath: "/repo/a/utils.ts", displayName: "utils.ts" } },
        { id: B, attrs: { kind: "file", filePath: "/repo/b/utils.ts", displayName: "utils.ts" } },
      ],
      []
    );
    await expect(run({ target: "utils.ts" }, view)).rejects.toThrow(/ambiguous/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: includePaths
// ---------------------------------------------------------------------------

describe("get_blast_radius – includePaths", () => {
  it("includes examplePath for each dependent when includePaths=true", async () => {
    //  main → app → service → core
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: SERVICE, attrs: SERVICE_ATTRS },
        { id: APP, attrs: APP_ATTRS },
        { id: MAIN, attrs: MAIN_ATTRS },
      ],
      [
        { source: SERVICE, target: CORE },
        { source: APP, target: SERVICE },
        { source: MAIN, target: APP },
      ]
    );

    const result = await run({ target: CORE, includePaths: true }, view);

    for (const dep of result.dependents) {
      expect(dep.examplePath).toBeDefined();
      // Path must start with the dependent and end with the target
      expect(dep.examplePath?.[0]).toBe(dep.id);
      expect(dep.examplePath?.[dep.examplePath.length - 1]).toBe(CORE);
    }
  });

  it("omits examplePath when includePaths=false", async () => {
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: SERVICE, attrs: SERVICE_ATTRS },
      ],
      [{ source: SERVICE, target: CORE }]
    );

    const result = await run({ target: CORE, includePaths: false }, view);
    for (const dep of result.dependents) {
      expect(dep.examplePath).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: truncation
// ---------------------------------------------------------------------------

describe("get_blast_radius – truncation", () => {
  it("returns truncated=false for small graphs", async () => {
    const view = buildGraph(
      [
        { id: CORE, attrs: CORE_ATTRS },
        { id: UTILS, attrs: UTILS_ATTRS },
      ],
      [{ source: UTILS, target: CORE }]
    );
    const result = await run({ target: CORE }, view);
    expect(result.truncated).toBe(false);
    expect(result.total).toBe(result.dependents.length);
  });

  it("truncates when there are more dependents than the internal limit", async () => {
    // Build a star: all 2100 files import CORE
    const g = new DirectedGraph<NodeAttrs, EdgeAttrs>();
    g.addNode(CORE, CORE_ATTRS);
    const count = 2_100;
    for (let i = 0; i < count; i++) {
      const id = fileId(`/repo/src/dep${i}.ts`);
      g.addNode(id, {
        kind: "file",
        filePath: `/repo/src/dep${i}.ts`,
        displayName: `dep${i}.ts`,
      });
      g.addEdge(id, CORE, { kind: "imports" });
    }
    const view = createGraphView(g);

    const result = await run({ target: CORE }, view);
    expect(result.truncated).toBe(true);
    expect(result.dependents.length).toBeLessThan(count);
    expect(result.total).toBeGreaterThan(result.dependents.length);
  });
});
