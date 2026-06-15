import { describe, it, expect } from "vitest";
import { OverlayStore } from "../../src/graph/overlay-store.js";
import { fileId, symbolId } from "../../src/graph/node-id.js";
import type { FileSlice } from "../../src/graph/overlay-store.js";

describe("node-id", () => {
  it("makes stable file ids", () => {
    expect(fileId("src/foo.ts")).toBe("file:src/foo.ts");
  });

  it("makes symbol ids", () => {
    expect(symbolId("src/foo.ts", "Foo")).toBe("sym:src/foo.ts#Foo");
  });
});

describe("OverlayStore + ComposedView", () => {
  function makeSlice(filePath: string, suffix = ""): FileSlice {
    return {
      filePath,
      nodes: [
        {
          id: fileId(filePath),
          attrs: { kind: "file", filePath, displayName: filePath, language: "ts" },
        },
        {
          id: symbolId(filePath, `Fn${suffix}`),
          attrs: {
            kind: "symbol",
            filePath,
            symbolName: `Fn${suffix}`,
            displayName: `Fn${suffix}`,
          },
        },
      ],
      edges: [],
    };
  }

  it("empty overlay view equals base", () => {
    const store = new OverlayStore();
    store.applyBaseSlice(makeSlice("src/a.ts"));

    const view = store.composedView("wt-test");
    expect(view.hasNode(fileId("src/a.ts"))).toBe(true);
    expect(view.hasNode(symbolId("src/a.ts", "Fn"))).toBe(true);
  });

  it("overlay replaces base slice", () => {
    const store = new OverlayStore();
    store.applyBaseSlice(makeSlice("src/a.ts", "base"));

    store.applyOverlaySlice("wt-1", makeSlice("src/a.ts", "overlay"));

    const view = store.composedView("wt-1");
    expect(view.hasNode(symbolId("src/a.ts", "Fnoverlay"))).toBe(true);
    expect(view.hasNode(symbolId("src/a.ts", "Fnbase"))).toBe(false);
  });

  it("overlay deleted file hides base slice", () => {
    const store = new OverlayStore();
    store.applyBaseSlice(makeSlice("src/b.ts"));

    store.markOverlayDeleted("wt-2", "src/b.ts");

    const view = store.composedView("wt-2");
    expect(view.hasNode(fileId("src/b.ts"))).toBe(false);
  });

  it("different overlays are isolated", () => {
    const store = new OverlayStore();
    store.applyBaseSlice(makeSlice("src/c.ts", "base"));

    store.applyOverlaySlice("wt-A", makeSlice("src/c.ts", "A"));
    store.applyOverlaySlice("wt-B", makeSlice("src/c.ts", "B"));

    const viewA = store.composedView("wt-A");
    const viewB = store.composedView("wt-B");

    expect(viewA.hasNode(symbolId("src/c.ts", "FnA"))).toBe(true);
    expect(viewA.hasNode(symbolId("src/c.ts", "FnB"))).toBe(false);
    expect(viewB.hasNode(symbolId("src/c.ts", "FnB"))).toBe(true);
    expect(viewB.hasNode(symbolId("src/c.ts", "FnA"))).toBe(false);
  });
});
