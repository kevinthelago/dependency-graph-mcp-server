/**
 * ResolverHook — the plug-in point each language analyzer provides to resolve
 * its module specifiers into graph node ids.
 *
 * The tree-sitter scaffold handles parsing + query execution; each language's
 * analyzer implements this hook to encapsulate its resolution logic.
 */

import type { ProjectContext } from '../types.js'

/**
 * Result of resolving a module specifier.
 *
 * - `{ kind: 'file', repoRelPath }` — resolved to a project file (by path).
 * - `{ kind: 'external', spec }` — third-party / stdlib; becomes an external leaf.
 * - `{ kind: 'unresolved' }` — could not be resolved; edge emitted with resolution:"unresolved".
 */
export type ResolveResult =
  | { kind: 'file'; repoRelPath: string }
  | { kind: 'external'; spec: string }
  | { kind: 'unresolved' }

/**
 * Each language analyzer implements this interface to plug module resolution
 * into the shared tree-sitter scaffold.
 *
 * The resolver is stateful (it may cache lookups) but must be deterministic:
 * same inputs → same result for any given `ProjectContext`.
 */
export interface ResolverHook {
  /**
   * Resolve `specifier` (the raw module/import string from the source)
   * imported from `fromFile` (repo-relative) using `ctx`.
   */
  resolve(
    specifier: string,
    fromFile: string,
    ctx: ProjectContext,
  ): ResolveResult
}
