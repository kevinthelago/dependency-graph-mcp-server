import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import { seedOverlay } from "../../src/worktree/overlay.js";
import type { ChangedFile } from "../../src/worktree/diff.js";
import {
  MemoryOverlay,
  MemoryCache,
  NoopCache,
  makeStubAnalyzer,
  fileNode,
  testProjectContext,
  makeTempDir,
  writeFile,
} from "./helpers.js";
import type { AnalysisFragment } from "../../src/analyzers/types.js";

function makeFragment(filePath: string, text: string): AnalysisFragment {
  return {
    file: fileNode(filePath),
    symbols: [],
    edges: [],
    imports: [],
  };
}

describe("seedOverlay", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("applies changed files to the overlay", async () => {
    await writeFile(tmpRoot, "src/a.ts", "export const x = 1;");

    const overlay = new MemoryOverlay();
    const analyzer = makeStubAnalyzer([".ts"], makeFragment);

    const changedFiles: ChangedFile[] = [{ path: "src/a.ts", status: "changed" }];
    await seedOverlay({
      worktreeRoot: tmpRoot,
      repoRoot: tmpRoot,
      baseBranch: "develop",
      overlay,
      changedFiles,
      getAnalyzer: (p) => (p.endsWith(".ts") ? analyzer : undefined),
      cache: new NoopCache(),
      projectContext: testProjectContext,
    });

    expect(overlay.appliedCount()).toBe(1);
    expect(overlay.getSlice("src/a.ts")).toBeTruthy();
    expect(overlay.isEmpty()).toBe(false);
  });

  it("marks deleted files as deleted in the overlay", async () => {
    const overlay = new MemoryOverlay();
    const changedFiles: ChangedFile[] = [{ path: "src/gone.ts", status: "deleted" }];

    await seedOverlay({
      worktreeRoot: tmpRoot,
      repoRoot: tmpRoot,
      baseBranch: "develop",
      overlay,
      changedFiles,
      getAnalyzer: () => undefined,
      cache: new NoopCache(),
      projectContext: testProjectContext,
    });

    expect(overlay.isDeleted("src/gone.ts")).toBe(true);
    expect(overlay.appliedCount()).toBe(0);
  });

  it("produces an empty overlay for a clean worktree (no changed files)", async () => {
    const overlay = new MemoryOverlay();

    await seedOverlay({
      worktreeRoot: tmpRoot,
      repoRoot: tmpRoot,
      baseBranch: "develop",
      overlay,
      changedFiles: [],
      getAnalyzer: () => undefined,
      cache: new NoopCache(),
      projectContext: testProjectContext,
    });

    expect(overlay.isEmpty()).toBe(true);
  });

  it("skips files with no registered analyzer", async () => {
    await writeFile(tmpRoot, "README.md", "# hello");

    const overlay = new MemoryOverlay();
    const changedFiles: ChangedFile[] = [{ path: "README.md", status: "changed" }];

    await seedOverlay({
      worktreeRoot: tmpRoot,
      repoRoot: tmpRoot,
      baseBranch: "develop",
      overlay,
      changedFiles,
      getAnalyzer: () => undefined, // no analyzer for .md
      cache: new NoopCache(),
      projectContext: testProjectContext,
    });

    expect(overlay.isEmpty()).toBe(true);
  });

  it("uses cache on second seed of the same content", async () => {
    await writeFile(tmpRoot, "src/b.ts", "export const y = 2;");

    let callCount = 0;
    const analyzer = makeStubAnalyzer([".ts"], (p, t) => {
      callCount++;
      return makeFragment(p, t);
    });
    const cache = new MemoryCache();

    const changedFiles: ChangedFile[] = [{ path: "src/b.ts", status: "changed" }];
    const shared = {
      worktreeRoot: tmpRoot,
      repoRoot: tmpRoot,
      baseBranch: "develop",
      changedFiles,
      getAnalyzer: (_p: string) => analyzer,
      cache,
      projectContext: testProjectContext,
    };

    await seedOverlay({ ...shared, overlay: new MemoryOverlay() });
    await seedOverlay({ ...shared, overlay: new MemoryOverlay() });

    // Analyzer should only be called once; second call hits cache
    expect(callCount).toBe(1);
  });

  it("treats a file that disappears between diff and seed as deleted", async () => {
    // File does NOT exist on disk but is listed as "changed"
    const overlay = new MemoryOverlay();
    const analyzer = makeStubAnalyzer([".ts"], makeFragment);
    const changedFiles: ChangedFile[] = [{ path: "src/ghost.ts", status: "changed" }];

    await seedOverlay({
      worktreeRoot: tmpRoot,
      repoRoot: tmpRoot,
      baseBranch: "develop",
      overlay,
      changedFiles,
      getAnalyzer: (_p) => analyzer,
      cache: new NoopCache(),
      projectContext: testProjectContext,
    });

    expect(overlay.isDeleted("src/ghost.ts")).toBe(true);
    expect(overlay.appliedCount()).toBe(0);
  });

  it("handles multiple files: some changed, some deleted, some added", async () => {
    await writeFile(tmpRoot, "src/keep.ts", "export const k = 1;");
    await writeFile(tmpRoot, "src/new.ts", "export const n = 2;");

    const overlay = new MemoryOverlay();
    const analyzer = makeStubAnalyzer([".ts"], makeFragment);
    const changedFiles: ChangedFile[] = [
      { path: "src/keep.ts", status: "changed" },
      { path: "src/new.ts", status: "added" },
      { path: "src/removed.ts", status: "deleted" },
    ];

    await seedOverlay({
      worktreeRoot: tmpRoot,
      repoRoot: tmpRoot,
      baseBranch: "develop",
      overlay,
      changedFiles,
      getAnalyzer: (_p) => analyzer,
      cache: new NoopCache(),
      projectContext: testProjectContext,
    });

    expect(overlay.appliedCount()).toBe(2);
    expect(overlay.isDeleted("src/removed.ts")).toBe(true);
    expect(overlay.isEmpty()).toBe(false);
  });
});

describe("overlay isolation", () => {
  it("two overlays are independent", async () => {
    const overlay1 = new MemoryOverlay();
    const overlay2 = new MemoryOverlay();

    const tmpRoot1 = await makeTempDir();
    const tmpRoot2 = await makeTempDir();
    try {
      await writeFile(tmpRoot1, "src/a.ts", "export const a = 1;");
      await writeFile(tmpRoot2, "src/b.ts", "export const b = 2;");

      const analyzer = makeStubAnalyzer([".ts"], makeFragment);

      await seedOverlay({
        worktreeRoot: tmpRoot1,
        repoRoot: tmpRoot1,
        baseBranch: "develop",
        overlay: overlay1,
        changedFiles: [{ path: "src/a.ts", status: "changed" }],
        getAnalyzer: (_p) => analyzer,
        cache: new NoopCache(),
        projectContext: testProjectContext,
      });

      await seedOverlay({
        worktreeRoot: tmpRoot2,
        repoRoot: tmpRoot2,
        baseBranch: "develop",
        overlay: overlay2,
        changedFiles: [{ path: "src/b.ts", status: "changed" }],
        getAnalyzer: (_p) => analyzer,
        cache: new NoopCache(),
        projectContext: testProjectContext,
      });

      // Each overlay only contains its own file
      expect(overlay1.getSlice("src/a.ts")).toBeTruthy();
      expect(overlay1.getSlice("src/b.ts")).toBeUndefined();
      expect(overlay2.getSlice("src/b.ts")).toBeTruthy();
      expect(overlay2.getSlice("src/a.ts")).toBeUndefined();
    } finally {
      await fs.rm(tmpRoot1, { recursive: true, force: true });
      await fs.rm(tmpRoot2, { recursive: true, force: true });
    }
  });
});
