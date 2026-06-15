import type { Node, Edge, CaptureResult, IIncludeResolver } from './types.js';

export interface ImportExtractionResult {
  edges: Edge[];
  /** External leaf nodes created for out-of-project targets. */
  externalNodes: Node[];
}

/**
 * Strip surrounding quotes ("…") or angle-brackets (<…>) from an include path.
 */
function stripDelimiters(raw: string): string {
  return raw.replace(/^["<]|[">]$/g, '');
}

/**
 * Derive the Obj-C framework name from an angled include spec.
 * `<UIKit/UIKit.h>` → "UIKit"
 * `<Foundation/NSString.h>` → "Foundation"
 * `<dispatch/dispatch.h>` → "dispatch"
 */
function frameworkFromAngled(spec: string): string {
  const slash = spec.indexOf('/');
  return slash > 0 ? spec.slice(0, slash) : spec.replace(/\.h$/, '');
}

/**
 * Extracts import/include edges from tree-sitter captures produced by
 * IMPORT_QUERY. Uses the C/C++ include resolver for path resolution.
 *
 * Pure function given a concrete resolver — no disk access directly.
 */
export function extractImportEdges(
  captures: CaptureResult[],
  repoRelPath: string,
  resolver: IIncludeResolver,
): ImportExtractionResult {
  const edges: Edge[] = [];
  const externalNodes: Node[] = [];
  const seenExternal = new Set<string>();

  for (const cap of captures) {
    const { name, text, startPosition: sp } = cap;
    const loc = { line: sp.row + 1, col: sp.column };

    // @import Foundation; → always external (Apple framework)
    if (name === 'framework-import') {
      const extId = `ext:objc:${text}`;
      if (!seenExternal.has(extId)) {
        seenExternal.add(extId);
        externalNodes.push({
          id: extId,
          kind: 'external',
          language: 'objc',
          name: text,
        });
      }
      edges.push({
        from: `file:${repoRelPath}`,
        to: extId,
        kind: 'import',
        targetType: 'external',
        wildcard: true,  // @import imports the entire module
        resolution: 'unresolved',  // external by definition
        loc,
      });
      continue;
    }

    const spec = stripDelimiters(text);
    const quoted = name === 'quoted-include' || name === 'quoted-import';

    const resolved = resolver.resolve(spec, repoRelPath, quoted);

    if (resolved === null) {
      // Resolver couldn't determine location → unresolved edge
      edges.push({
        from: `file:${repoRelPath}`,
        to: `ext:objc:${spec}`,
        kind: 'import',
        targetType: 'external',
        resolution: 'unresolved',
        loc,
      });
    } else if (resolved.kind === 'file') {
      edges.push({
        from: `file:${repoRelPath}`,
        to: `file:${resolved.repoRelPath}`,
        kind: 'import',
        targetType: 'file',
        resolution: 'resolved',
        loc,
      });
    } else {
      // External (outside project)
      const framework = frameworkFromAngled(spec);
      const extId = `ext:objc:${framework}`;
      if (!seenExternal.has(extId)) {
        seenExternal.add(extId);
        externalNodes.push({
          id: extId,
          kind: 'external',
          language: 'objc',
          name: framework,
        });
      }
      edges.push({
        from: `file:${repoRelPath}`,
        to: extId,
        kind: 'import',
        targetType: 'external',
        resolution: 'unresolved',
        loc,
      });
    }
  }

  // Stable ordering
  edges.sort((a, b) => {
    const locA = a.loc ?? { line: 0, col: 0 };
    const locB = b.loc ?? { line: 0, col: 0 };
    return locA.line !== locB.line
      ? locA.line - locB.line
      : locA.col - locB.col;
  });

  return { edges, externalNodes };
}
