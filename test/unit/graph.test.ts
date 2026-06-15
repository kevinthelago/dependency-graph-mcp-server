import { describe, it, expect } from "vitest";
import { GraphStore } from "../../src/graph/store.js";
import { makeFileId, makeSymId, makeExtId, parseNodeId } from "../../src/graph/node-id.js";
import type { FileSlice } from "../../src/graph/model.js";

describe("node-id", () => {
  it("makes stable file ids", () => {
    expect(makeFileId("src/foo.ts")).toBe("file:src/foo.ts");
    expect(makeFileId("src\\foo.ts")).toBe("file:src/foo.ts");
  });

  it("makes symbol ids with collision suffixing", () => {
    const seen = new Map<string, number>();
    const id1 = makeSymId("src/foo.ts", "Foo", seen);
    const id2 = makeSymId("src/foo.ts", "Foo", seen);
    const id3 = makeSymId("src/foo.ts", "Foo", seen);
    expect(id1).toBe("sym:src/foo.ts#Foo");
    expect(id2).toBe("sym:src/foo.ts#Foo~1");
    expect(id3).toBe("sym:src/foo.ts#Foo~2");
  });

  it("makes external ids", () => {
    expect(makeExtId("ts", "react")).toBe("ext:ts:react");
  });

  it("parses ids", () => {
    expect(parseNodeId("file:src/foo.ts")).toEqual({ kind: "file", path: "src/foo.ts" });
    expect(parseNodeId("sym:src/foo.ts#Foo")).toEqual({ kind: "sym", path: "src/foo.ts", name: "Foo" });
    expect(parseNodeId("ext:ts:react")).toEqual({ kind: "ext", language: "ts", specifier: "react" });
    expect(parseNodeId("invalid")).toBeNull();
  });
});

describe("GraphStore + ComposedView", () => {
  function makeSlice(filePath: string, suffix = ""): FileSlice {
    return {
      filePath,
      nodes: [
        {
          id: makeFileId(filePath),
          kind: "file",
          language: "ts",
          name: filePath,
        },
        {
          id: `sym:${filePath}#Fn${suffix}`,
          kind: "symbol",
          language: "ts",
          name: `Fn${suffix}`,
          file: filePath,
        },
      ],
      edges: [],
    };
  }

  it("empty overlay view equals base", () => {
    const store = new GraphStore();
    const slice = makeSlice("src/a.ts");
    store.applyBaseSlice(slice);

    const view = store.composedView("wt-test");
    expect(view.hasNode(makeFileId("src/a.ts"))).toBe(true);
    expect(view.hasNode("sym:src/a.ts#Fn")).toBe(true);
  });

  it("overlay replaces base slice", () => {
    const store = new GraphStore();
    store.applyBaseSlice(makeSlice("src/a.ts", "base"));

    const overlaySlice = makeSlice("src/a.ts", "overlay");
    store.applyOverlaySlice("wt-1", overlaySlice);

    const view = store.composedView("wt-1");
    // overlay symbol visible
    expect(view.hasNode("sym:src/a.ts#Fnoverlay")).toBe(true);
    // base symbol hidden
    expect(view.hasNode("sym:src/a.ts#Fnbase")).toBe(false);
  });

  it("overlay deleted file hides base slice", () => {
    const store = new GraphStore();
    store.applyBaseSlice(makeSlice("src/b.ts"));

    store.markOverlayDeleted("wt-2", "src/b.ts");

    const view = store.composedView("wt-2");
    expect(view.hasNode(makeFileId("src/b.ts"))).toBe(false);
    expect(view.nodesForFile("src/b.ts")).toEqual([]);
  });

  it("different overlays are isolated", () => {
    const store = new GraphStore();
    store.applyBaseSlice(makeSlice("src/c.ts", "base"));

    store.applyOverlaySlice("wt-A", makeSlice("src/c.ts", "A"));
    store.applyOverlaySlice("wt-B", makeSlice("src/c.ts", "B"));

    const viewA = store.composedView("wt-A");
    const viewB = store.composedView("wt-B");

    expect(viewA.hasNode("sym:src/c.ts#FnA")).toBe(true);
    expect(viewA.hasNode("sym:src/c.ts#FnB")).toBe(false);
    expect(viewB.hasNode("sym:src/c.ts#FnB")).toBe(true);
    expect(viewB.hasNode("sym:src/c.ts#FnA")).toBe(false);
  });
});
