// ts-3: Import resolution — paths/baseUrl, external leaves, unresolved

import * as ts from 'typescript';
import * as path from 'node:path';
import type { Edge } from '../../graph/model.js';
import type { ImportRef } from '../types.js';
import { fileId, externalId } from '../../graph/node-id.js';
import { toRelPath } from './nodes.js';

export interface ImportResult {
  edges: Edge[];
  imports: ImportRef[];
}

/**
 * Walk all import/export-from declarations, resolve each specifier, and emit
 * import edges + ImportRef records. Honors tsconfig paths/baseUrl.
 */
export function extractImports(
  sourceFile: ts.SourceFile,
  compilerOptions: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
  repoRoot: string,
): ImportResult {
  const edges: Edge[] = [];
  const imports: ImportRef[] = [];
  const relPath = toRelPath(sourceFile.fileName, repoRoot);
  const fromId = fileId(relPath);

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      processModuleRef(
        stmt,
        stmt.moduleSpecifier,
        sourceFile,
        compilerOptions,
        host,
        repoRoot,
        fromId,
        edges,
        imports,
      );
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
      processModuleRef(
        stmt,
        stmt.moduleSpecifier,
        sourceFile,
        compilerOptions,
        host,
        repoRoot,
        fromId,
        edges,
        imports,
      );
    }
  }

  return { edges, imports };
}

function processModuleRef(
  stmt: ts.ImportDeclaration | ts.ExportDeclaration,
  moduleSpecifier: ts.Expression,
  sourceFile: ts.SourceFile,
  compilerOptions: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
  repoRoot: string,
  fromId: string,
  edges: Edge[],
  imports: ImportRef[],
): void {
  if (!ts.isStringLiteral(moduleSpecifier)) return;

  const specifier = moduleSpecifier.text;
  const isTypeOnly = isTypeOnlyDecl(stmt);
  const isWild = isWildcardDecl(stmt);
  const edgeLoc = stmtLoc(stmt, sourceFile);

  const resolved = ts.resolveModuleName(
    specifier,
    sourceFile.fileName,
    compilerOptions,
    host,
  );

  if (resolved.resolvedModule) {
    const resolvedFile = resolved.resolvedModule.resolvedFileName;
    const isExt = resolvedFile.includes('node_modules');

    if (isExt) {
      const pkg = packageName(specifier);
      const toId = externalId(pkg);
      edges.push(edge(fromId, toId, 'external', isTypeOnly, isWild, 'resolved', edgeLoc));
      imports.push({ specifier, resolution: 'resolved' });
    } else {
      const targetRel = toRelPath(resolvedFile, repoRoot);
      const toId = fileId(targetRel);
      edges.push(edge(fromId, toId, 'file', isTypeOnly, isWild, 'resolved', edgeLoc));
      imports.push({ specifier, resolvedPath: targetRel, resolution: 'resolved' });
    }
  } else {
    // Unresolved — still emit the edge with a best-effort external id
    const toId = externalId(specifier);
    edges.push(edge(fromId, toId, 'external', isTypeOnly, isWild, 'unresolved', edgeLoc));
    imports.push({ specifier, resolution: 'unresolved' });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function edge(
  from: string,
  to: string,
  targetType: Edge['targetType'],
  typeOnly: boolean,
  wildcard: boolean,
  resolution: Edge['resolution'],
  edgeLoc: { line: number; col: number } | undefined,
): Edge {
  const e: Edge = { from, to, kind: 'import', targetType, resolution };
  if (typeOnly) e.typeOnly = true;
  if (wildcard) e.wildcard = true;
  if (edgeLoc) e.loc = edgeLoc;
  return e;
}

function isTypeOnlyDecl(stmt: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(stmt)) return stmt.importClause?.isTypeOnly === true;
  return stmt.isTypeOnly === true;
}

function isWildcardDecl(stmt: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(stmt)) {
    const bindings = stmt.importClause?.namedBindings;
    return bindings !== undefined && ts.isNamespaceImport(bindings);
  }
  // export * from '...'
  return stmt.exportClause === undefined && stmt.moduleSpecifier !== undefined;
}

function stmtLoc(
  stmt: ts.Node,
  sourceFile: ts.SourceFile,
): { line: number; col: number } | undefined {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(stmt.getStart(sourceFile));
  return { line: line + 1, col: character + 1 };
}

/**
 * Extract the npm package name from a specifier.
 * `lodash` → `lodash`, `@types/node` → `@types/node`, `lodash/fp` → `lodash`
 */
export function packageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0] ?? ''}/${parts[1] ?? ''}` : specifier;
  }
  return specifier.split('/')[0] ?? specifier;
}
