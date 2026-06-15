// ts-4: Reference edges via the TypeScript type-checker (+ barrel pierce)

import * as ts from 'typescript';
import type { Edge } from '../../graph/model.js';
import { fileId, symbolId, externalId } from '../../graph/node-id.js';
import { toRelPath } from './nodes.js';
import { packageName } from './imports.js';

/**
 * Walk all identifier usages in `sourceFile` and emit cross-file reference edges.
 * Barrels are pierced: `checker.getAliasedSymbol` follows re-exports to real declarations.
 */
export function extractReferences(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  repoRoot: string,
  projectFileSet: Set<string>,
): Edge[] {
  const edges: Edge[] = [];
  const fromRelPath = toRelPath(sourceFile.fileName, repoRoot);
  const fromId = fileId(fromRelPath);
  const seen = new Set<string>(); // deduplicate by target node id

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && !isDeclarationName(node)) {
      const rawSym = checker.getSymbolAtLocation(node);
      if (!rawSym) {
        ts.forEachChild(node, visit);
        return;
      }

      // Pierce barrels / re-exports
      const sym =
        rawSym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(rawSym) : rawSym;

      const decls = sym.declarations;
      if (!decls || decls.length === 0) {
        ts.forEachChild(node, visit);
        return;
      }

      const firstDecl = decls[0];
      if (!firstDecl) {
        ts.forEachChild(node, visit);
        return;
      }

      const declFile = firstDecl.getSourceFile();
      // Skip self-references and ambient lib files not in the project
      if (
        declFile.fileName === sourceFile.fileName ||
        (declFile.isDeclarationFile && !projectFileSet.has(declFile.fileName))
      ) {
        ts.forEachChild(node, visit);
        return;
      }

      const isTypeRef = isTypePosition(node);
      const isExt = declFile.fileName.includes('node_modules');
      const refLoc = nodeLoc(node, sourceFile);

      if (isExt) {
        const pkg = packageName(extractPackageFromPath(declFile.fileName));
        const toId = externalId(pkg);
        if (!seen.has(toId)) {
          seen.add(toId);
          const e: Edge = {
            from: fromId,
            to: toId,
            kind: 'reference',
            targetType: 'external',
            resolution: 'resolved',
          };
          if (isTypeRef) e.typeOnly = true;
          if (refLoc) e.loc = refLoc;
          edges.push(e);
        }
      } else {
        const targetRelPath = toRelPath(declFile.fileName, repoRoot);
        const toId = symbolId(targetRelPath, sym.name);
        if (!seen.has(toId)) {
          seen.add(toId);
          const e: Edge = {
            from: fromId,
            to: toId,
            kind: 'reference',
            targetType: 'symbol',
            resolution: 'resolved',
          };
          if (isTypeRef) e.typeOnly = true;
          if (refLoc) e.loc = refLoc;
          edges.push(e);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return edges;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when the node is a name in a declaration (not a usage). */
function isDeclarationName(node: ts.Identifier): boolean {
  const p = node.parent;
  if (!p) return false;
  return (
    (ts.isFunctionDeclaration(p) && p.name === node) ||
    (ts.isFunctionExpression(p) && p.name === node) ||
    (ts.isArrowFunction(p) && p.name === node) ||
    (ts.isClassDeclaration(p) && p.name === node) ||
    (ts.isClassExpression(p) && p.name === node) ||
    (ts.isVariableDeclaration(p) && p.name === node) ||
    (ts.isInterfaceDeclaration(p) && p.name === node) ||
    (ts.isTypeAliasDeclaration(p) && p.name === node) ||
    (ts.isEnumDeclaration(p) && p.name === node) ||
    (ts.isEnumMember(p) && p.name === node) ||
    (ts.isModuleDeclaration(p) && p.name === node) ||
    (ts.isPropertySignature(p) && p.name === node) ||
    (ts.isPropertyDeclaration(p) && p.name === node) ||
    (ts.isMethodSignature(p) && p.name === node) ||
    (ts.isMethodDeclaration(p) && p.name === node) ||
    (ts.isParameter(p) && p.name === node) ||
    (ts.isImportClause(p) && p.name === node) ||
    (ts.isImportSpecifier(p) && p.propertyName === node) ||
    (ts.isImportSpecifier(p) && p.name === node) ||
    (ts.isNamespaceImport(p) && p.name === node) ||
    (ts.isExportSpecifier(p) && p.name === node) ||
    (ts.isNamedExports(p.parent) && ts.isExportSpecifier(p))
  );
}

/** True when the identifier appears in a type position (e.g., type annotation, extends). */
function isTypePosition(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return false;
  return (
    ts.isTypeReferenceNode(p) ||
    ts.isTypeQueryNode(p) ||
    ts.isHeritageClause(p) ||
    ts.isTypePredicateNode(p) ||
    (ts.isExpressionWithTypeArguments(p) && p.expression === node)
  );
}

function nodeLoc(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): { line: number; col: number } | undefined {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, col: character + 1 };
}

/** Extract the npm package name from a node_modules path. */
function extractPackageFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('node_modules/');
  if (idx < 0) return filePath;
  const after = normalized.slice(idx + 'node_modules/'.length);
  if (after.startsWith('@')) {
    const parts = after.split('/');
    return parts.length >= 2 ? `${parts[0] ?? ''}/${parts[1] ?? ''}` : after;
  }
  return after.split('/')[0] ?? after;
}
