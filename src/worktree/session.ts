import type { WorktreeId } from "../graph/store.js";

/**
 * In-process session -> worktreeId binding.
 *
 * The MCP SDK doesn't expose a per-session context in tool handlers today,
 * so we manage this map explicitly. `register_worktree` calls `bindSession`;
 * tool handlers call `getWorktreeId` with whatever session identifier is
 * available (worktree id itself passed through or looked up from auth context).
 */

const store = new Map<string, WorktreeId>();

export function bindSession(sessionKey: string, worktreeId: WorktreeId): void {
  store.set(sessionKey, worktreeId);
}

export function getWorktreeId(sessionKey: string): WorktreeId | null {
  return store.get(sessionKey) ?? null;
}

export function unbindSession(sessionKey: string): void {
  store.delete(sessionKey);
}

export function listSessions(): Array<{ sessionKey: string; worktreeId: WorktreeId }> {
  return [...store.entries()].map(([sessionKey, worktreeId]) => ({
    sessionKey,
    worktreeId,
  }));
}
