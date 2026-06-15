/**
 * Python node extraction.
 *
 * Extracts the file node and top-level symbol nodes from a parsed Python tree.
 * v1 emits top-level symbols only (no class members / nested functions).
 */

import type { GraphNode, SymbolKind } from '../types.js'
import { fileId, symbolId } from '../../graph/node-id.js'
import type { PatternMatch } from '../tree-sitter/index.js'

const DEFINITION_TO_SYMBOL_KIND: Record<string, SymbolKind> = {
  'definition.function': 'function',
  'definition.class': 'class',
  'definition.variable': 'variable',
}

/**
 * Build the file node for a Python source file.
 *
 * @param repoRelPath  Repo-relative path (forward-slashes).
 */
export function buildFileNode(repoRelPath: string): GraphNode {
  return {
    id: fileId(repoRelPath),
    kind: 'file',
    language: 'python',
    name: repoRelPath,
  }
}

/**
 * Extract top-level symbol nodes from the tag query matches.
 *
 * Handles duplicate symbol names within the same file by appending `~n`.
 *
 * @param matches     Output of `QueryRunner.matches(tagsQuery, tree)`.
 * @param repoRelPath Repo-relative path.
 */
export function extractSymbols(
  matches: PatternMatch[],
  repoRelPath: string,
): GraphNode[] {
  const seen = new Map<string, number>()
  const nodes: GraphNode[] = []

  for (const match of matches) {
    for (const cap of match.captures) {
      const kind = DEFINITION_TO_SYMBOL_KIND[cap.name]
      if (!kind) continue

      const name = cap.node.text
      const count = seen.get(name) ?? 0
      seen.set(name, count + 1)

      const id = symbolId(repoRelPath, name, count)
      const loc = {
        line: cap.node.startPosition.row,
        col: cap.node.startPosition.column,
      }

      // Heuristic: names starting with _ (but not __dunder__) are unexported.
      // True export detection would need __all__ analysis (deferred to later).
      const exported =
        !name.startsWith('_') || (name.startsWith('__') && name.endsWith('__'))

      nodes.push({
        id,
        kind: 'symbol',
        language: 'python',
        name,
        symbolKind: kind,
        file: repoRelPath,
        loc,
        exported,
      })
    }
  }

  return nodes
}
