/**
 * Session scoping — owned by core-7; stub for worktree-view compilation.
 * Maps an MCP session id to a worktreeId.
 */

export declare function getSessionWorktreeId(sessionId: string): string | undefined;
export declare function bindSession(sessionId: string, worktreeId: string): void;
export declare function unbindSession(sessionId: string): void;
