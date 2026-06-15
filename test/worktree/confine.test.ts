import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import { confinePathToRoot, confineWorktreeRoot, isWithin, ConfinementError } from "../../src/worktree/confine.js";
import { makeTempDir } from "./helpers.js";

describe("isWithin", () => {
  it("returns true when candidate equals root", () => {
    expect(isWithin("/a/b", "/a/b")).toBe(true);
  });

  it("returns true when candidate is a subdirectory", () => {
    expect(isWithin("/a/b/c/d", "/a/b")).toBe(true);
  });

  it("returns false when candidate is outside root", () => {
    expect(isWithin("/a/bc", "/a/b")).toBe(false);
  });

  it("returns false for a parent path", () => {
    expect(isWithin("/a", "/a/b")).toBe(false);
  });

  it("handles trailing slashes", () => {
    expect(isWithin("/a/b/c", "/a/b/")).toBe(true);
  });

  it("handles Windows-style backslashes", () => {
    expect(isWithin("C:\\a\\b\\c", "C:\\a\\b")).toBe(true);
  });
});

describe("confinePathToRoot", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("allows a file inside the root", async () => {
    const filePath = nodePath.join(tmpRoot, "src", "index.ts");
    await fs.mkdir(nodePath.join(tmpRoot, "src"), { recursive: true });
    await fs.writeFile(filePath, "// hello", "utf8");

    const resolved = await confinePathToRoot(filePath, tmpRoot);
    expect(resolved).toContain("src");
  });

  it("rejects a path with '..' components", async () => {
    const escapePath = nodePath.join(tmpRoot, "..", "escape");
    await expect(confinePathToRoot(escapePath, tmpRoot)).rejects.toThrow(ConfinementError);
  });

  it("rejects a non-existent file outside root via ancestor check", async () => {
    const outsidePath = nodePath.join(tmpRoot, "..", "other-dir", "file.ts");
    await expect(confinePathToRoot(outsidePath, tmpRoot)).rejects.toThrow(ConfinementError);
  });

  it("rejects a symlink pointing outside the root", async () => {
    const outsideDir = await makeTempDir();
    try {
      const outsideFile = nodePath.join(outsideDir, "secret.ts");
      await fs.writeFile(outsideFile, "secret", "utf8");
      const symlinkPath = nodePath.join(tmpRoot, "link.ts");
      try {
        await fs.symlink(outsideFile, symlinkPath);
      } catch (err: unknown) {
        // Windows requires elevated privileges for symlinks; skip if unavailable.
        if ((err as NodeJS.ErrnoException).code === "EPERM") return;
        throw err;
      }

      await expect(confinePathToRoot(symlinkPath, tmpRoot)).rejects.toThrow(ConfinementError);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("confineWorktreeRoot", () => {
  let repoRoot: string;
  let worktreeRoot: string;

  beforeEach(async () => {
    repoRoot = await makeTempDir();
    worktreeRoot = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(worktreeRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("allows a worktree root that exactly matches an allowed root", async () => {
    const real = await confineWorktreeRoot(worktreeRoot, [worktreeRoot, repoRoot]);
    expect(real).toBeTruthy();
  });

  it("rejects a worktree root not in the allowed set", async () => {
    const foreign = await makeTempDir();
    try {
      await expect(confineWorktreeRoot(foreign, [worktreeRoot, repoRoot])).rejects.toThrow(ConfinementError);
    } finally {
      await fs.rm(foreign, { recursive: true, force: true });
    }
  });

  it("rejects a non-existent path", async () => {
    await expect(confineWorktreeRoot("/no/such/path", [repoRoot])).rejects.toThrow(ConfinementError);
  });
});
