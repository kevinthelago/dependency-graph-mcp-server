import { describe, it, expect, afterAll } from "vitest";
import { ParseCache, contentHash } from "../../src/cache/index.js";
import type { AnalysisFragment } from "../../src/analyzers/types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmpDir = mkdtempSync(join(tmpdir(), "dep-graph-cache-test-"));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const fakeFragment: AnalysisFragment = {
  file: { id: "file:src/x.ts", kind: "file", language: "ts", name: "src/x.ts" },
  symbols: [],
  edges: [],
  imports: [],
};

describe("ParseCache", () => {
  it("miss returns undefined", () => {
    const cache = new ParseCache(join(tmpDir, "test1.db"));
    const result = cache.get({
      analyzerId: "ts",
      analyzerVersion: "1.0",
      grammarVersion: "0",
      contentHash: "abc",
    });
    expect(result).toBeUndefined();
    cache.close();
  });

  it("put then get returns fragment", () => {
    const cache = new ParseCache(join(tmpDir, "test2.db"));
    const key = {
      analyzerId: "ts",
      analyzerVersion: "1.0",
      grammarVersion: "0",
      contentHash: contentHash("const x = 1;"),
    };
    cache.put(key, fakeFragment);
    const got = cache.get(key);
    expect(got).toEqual(fakeFragment);
    cache.close();
  });

  it("different analyzer version is a cache miss", () => {
    const cache = new ParseCache(join(tmpDir, "test3.db"));
    const key1 = { analyzerId: "ts", analyzerVersion: "1.0", grammarVersion: "0", contentHash: "h1" };
    const key2 = { ...key1, analyzerVersion: "2.0" };
    cache.put(key1, fakeFragment);
    expect(cache.get(key2)).toBeUndefined();
    cache.close();
  });

  it("LRU eviction respects maxEntries", () => {
    const cache = new ParseCache(join(tmpDir, "test4.db"), 3);
    for (let i = 0; i < 5; i++) {
      cache.put(
        { analyzerId: "ts", analyzerVersion: "1.0", grammarVersion: "0", contentHash: `h${i}` },
        fakeFragment,
      );
    }
    let found = 0;
    for (let i = 0; i < 5; i++) {
      if (cache.get({ analyzerId: "ts", analyzerVersion: "1.0", grammarVersion: "0", contentHash: `h${i}` }))
        found++;
    }
    expect(found).toBe(3);
    cache.close();
  });

  it("contentHash is deterministic", () => {
    expect(contentHash("hello")).toBe(contentHash("hello"));
    expect(contentHash("hello")).not.toBe(contentHash("world"));
  });
});
