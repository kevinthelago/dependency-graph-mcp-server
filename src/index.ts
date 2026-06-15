// Graph model, ids, store (shared with all streams)
export * from "./graph/model.js";
export * from "./graph/node-id.js";
export * from "./graph/store.js";

// Overlay store (core stream: worktree + base index support)
export { OverlayStore } from "./graph/overlay-store.js";
// Note: FileSlice from overlay-store differs from model.ts FileSlice — import directly when needed

// Query layer (query-dependencies stream)
export * from "./query/types.js";
export * from "./query/resolver.js";
export * from "./query/traversal.js";

// Tools (blast-radius + other streams)
export * from "./server/tools/get-blast-radius.js";

// Parse cache
export { ParseCache, contentHash, makeCacheKey } from "./cache/index.js";
export type { CacheKey } from "./cache/index.js";

// Analyzer interface — export only names not already in graph/model.js
export type {
  LanguageAnalyzer,
  ProjectContext,
  AnalysisFragment,
  ImportRef,
  ExternalRef,
  GraphNode,
} from "./analyzers/types.js";
export { AnalyzerRegistry } from "./analyzers/registry.js";

// MCP server
export { McpServer } from "./server/index.js";
export type { ToolDef, ToolCtx } from "./mcp/types.js";
export { notFound, noWorktree, paginate, structuredError } from "./server/envelope.js";

// Worktree
export { WorktreeRegistry } from "./worktree/registry.js";
export type { WorktreeEntry } from "./worktree/registry.js";
export {
  bindSession,
  getWorktreeId,
  unbindSession,
} from "./worktree/session.js";

// Orchestrator — core exports + live-graph incremental pipeline
export { Orchestrator, InvalidationEmitter } from "./orchestrator/index.js";
export { buildBaseIndex } from "./orchestrator/base-index.js";
export * from './orchestrator/incremental.js';
export * from './orchestrator/reresolve.js';
export * from './orchestrator/invalidation.js';

// Watcher (live-graph stream)
export * from './watcher/index.js';

// Tools
export { makeRegisterWorktreeTool } from "./server/tools/register-worktree.js";
