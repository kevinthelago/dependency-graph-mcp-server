import { describe, it, expect } from "vitest";
import { WorktreeRegistry } from "../../src/worktree/registry.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("WorktreeRegistry", () => {
  it("registers a valid worktree", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "repo-"));
    const worktreeRoot = mkdtempSync(join(repoRoot, "wt-"));

    const registry = new WorktreeRegistry(repoRoot);
    const entry = await registry.register({ worktreeRoot });

    expect(entry.worktreeId).toMatch(/^wt-\d+$/);
    expect(entry.worktreeRoot).toBeTruthy();
    expect(entry.baseBranch).toBe("develop");
  });

  it("reuses entry for same worktree root", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "repo2-"));
    const wtRoot = mkdtempSync(join(repoRoot, "wt2-"));

    const registry = new WorktreeRegistry(repoRoot);
    const e1 = await registry.register({ worktreeRoot: wtRoot });
    const e2 = await registry.register({ worktreeRoot: wtRoot });

    expect(e1.worktreeId).toBe(e2.worktreeId);
  });

  it("rejects path traversal", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "repo3-"));
    const registry = new WorktreeRegistry(repoRoot);

    await expect(
      registry.register({ worktreeRoot: "/tmp/evil" }),
    ).rejects.toThrow(/escape/);
  });

  it("confinePath rejects escaping paths", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "repo4-"));
    const wtRoot = mkdtempSync(join(repoRoot, "wt4-"));
    const registry = new WorktreeRegistry(repoRoot);
    const entry = await registry.register({ worktreeRoot: wtRoot });

    expect(() =>
      registry.confinePath(entry.worktreeId, "../../etc/passwd"),
    ).toThrow(/escape/);
  });
});
