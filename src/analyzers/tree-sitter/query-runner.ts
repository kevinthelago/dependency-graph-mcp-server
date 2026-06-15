/**
 * Tree-sitter query runner.
 *
 * Wraps web-tree-sitter's Query API with a cache so each (language, source)
 * pair compiles the query exactly once.
 */

import { Query } from 'web-tree-sitter'
import type { Language, Tree, Node as SyntaxNode, QueryCapture } from 'web-tree-sitter'

export interface CaptureResult {
  name: string
  node: SyntaxNode
}

export interface PatternMatch {
  patternIndex: number
  captures: CaptureResult[]
}

export class QueryRunner {
  private readonly queryCache = new Map<string, Query>()

  constructor(private readonly language: Language) {}

  /** Compile and cache a tree-sitter query. */
  private getQuery(source: string): Query {
    const cached = this.queryCache.get(source)
    if (cached) return cached
    const q = new Query(this.language, source)
    this.queryCache.set(source, q)
    return q
  }
  /**
   * Run a query and return all matches with named captures.
   * Matches are returned in document order (ascending start byte).
   */
  matches(querySource: string, tree: Tree): PatternMatch[] {
    const q = this.getQuery(querySource)
    return q.matches(tree.rootNode).map((m) => ({
      patternIndex: m.patternIndex,
      captures: m.captures.map((c: QueryCapture) => ({
        name: c.name,
        node: c.node,
      })),
    }))
  }

  /**
   * Run a query and return flat captures (simpler than full matches when
   * pattern index isn't needed).
   */
  captures(querySource: string, tree: Tree): CaptureResult[] {
    const q = this.getQuery(querySource)
    return q.captures(tree.rootNode).map((c: QueryCapture) => ({
      name: c.name,
      node: c.node,
    }))
  }

  /** Release compiled query objects. */
  dispose(): void {
    for (const q of this.queryCache.values()) {
      q.delete()
    }
    this.queryCache.clear()
  }
}
