/**
 * Include directive extraction and edge building — part of cpp-2 (issue #58).
 *
 * Walks the tree-sitter parse tree to find all preproc_include nodes,
 * resolves them via the IncludeResolver, and produces edges + ImportRef records.
 */

import type { TreeNode } from '../tree-sitter/index.js';
import type { Edge } from '../../graph/model.js';
import type { ImportRef } from '../types.js';
import { fileId, externalId } from '../../graph/node-id.js';
import type { IncludeResolver } from './resolver.js';

export interface RawInclude {
  /** Path token as written between the delimiters, e.g. "stdio.h" or "util/helper.h". */
  rawPath: string;
  /** True for `"..."` includes, false for `<...>`. */
  isQuoted: boolean;
  loc: { line: number; col: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree walking
// ─────────────────────────────────────────────────────────────────────────────

/** Extract every #include directive from the parse tree. */
export function extractRawIncludes(rootNode: TreeNode): RawInclude[] {
  const result: RawInclude[] = [];
  visitIncludes(rootNode, result);
  return result;
}

function visitIncludes(node: TreeNode, out: RawInclude[]): void {
  if (node.type === 'preproc_include') {
    const pathNode = node.childForFieldName('path');
    if (pathNode) {
      const isQuoted = pathNode.type === 'string_literal';
      const text = pathNode.text;
      const rawPath = text.length >= 2 ? text.slice(1, -1) : text;
      out.push({
        rawPath,
        isQuoted,
        loc: {
          line: pathNode.startPosition.row + 1,
          col: pathNode.startPosition.column,
        },
      });
    }
  }
  for (const child of node.children) {
    visitIncludes(child, out);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge construction
// ─────────────────────────────────────────────────────────────────────────────

export interface IncludeEdgeResult {
  edges: Edge[];
  imports: ImportRef[];
}

/**
 * Resolve each raw include and build import edges + ImportRef records.
 * In-project headers become resolved file→file edges.
 * Unresolved / system headers become unresolved file→ext edges.
 */
export function buildIncludeEdges(
  rawIncludes: RawInclude[],
  fromFile: string,
  resolver: IncludeResolver,
): IncludeEdgeResult {
  const edges: Edge[] = [];
  const imports: ImportRef[] = [];
  const srcId = fileId(fromFile);

  for (const inc of rawIncludes) {
    const resolved = resolver.resolve(inc.rawPath, fromFile, inc.isQuoted);
    const loc = { line: inc.loc.line, col: inc.loc.col };

    if (resolved.resolvedPath !== null) {
      edges.push({
        from: srcId,
        to: fileId(resolved.resolvedPath),
        kind: 'import',
        targetType: 'file',
        resolution: 'resolved',
        loc,
      });
      imports.push({
        specifier: inc.rawPath,
        resolvedPath: resolved.resolvedPath,
        isExternal: false,
        isUnresolved: false,
        wildcard: false,
      });
    } else {
      edges.push({
        from: srcId,
        to: externalId(inc.rawPath),
        kind: 'import',
        targetType: 'external',
        resolution: 'unresolved',
        loc,
      });
      imports.push({
        specifier: inc.rawPath,
        isExternal: true,
        isUnresolved: true,
        wildcard: false,
      });
    }
  }

  return { edges, imports };
}
