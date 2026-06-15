// ts-2: Node extraction — file node + top-level symbol nodes

import * as ts from 'typescript';
import * as path from 'node:path';
import type { Node, Language, SymbolKind } from '../../graph/model.js';
import { fileId, symbolId } from '../../graph/node-id.js';

export interface ExtractedNodes {
  file: Node;
  symbols: Node[];
}

/**
 * Extract the file node and all top-level symbol nodes from a SourceFile.
 * Resets the per-file symbol collision counter before extracting.
 */
export function extractNodes(sourceFile: ts.SourceFile, repoRoot: string): ExtractedNodes {
  const relPath = toRelPath(sourceFile.fileName, repoRoot);
  const lang = detectLanguage(sourceFile.fileName);

  const file: Node = {
    id: fileId(relPath),
    kind: 'file',
    language: lang,
    name: relPath,
  };

  const symbols: Node[] = [];
  for (const stmt of sourceFile.statements) {
    extractStatement(stmt, relPath, lang, sourceFile, symbols);
  }

  return { file, symbols };
}

// ---------------------------------------------------------------------------
// Statement extraction
// ---------------------------------------------------------------------------

function extractStatement(
  stmt: ts.Statement,
  relPath: string,
  lang: Language,
  sourceFile: ts.SourceFile,
  out: Node[],
): void {
  if (ts.isFunctionDeclaration(stmt) && stmt.name) {
    out.push(makeSymNode(stmt.name.text, 'function', relPath, lang, hasExport(stmt), loc(stmt, sourceFile)));
  } else if (ts.isClassDeclaration(stmt) && stmt.name) {
    out.push(makeSymNode(stmt.name.text, 'class', relPath, lang, hasExport(stmt), loc(stmt, sourceFile)));
  } else if (ts.isVariableStatement(stmt)) {
    const exported = hasExport(stmt);
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        out.push(makeSymNode(decl.name.text, 'variable', relPath, lang, exported, loc(decl, sourceFile)));
      }
    }
  } else if (ts.isInterfaceDeclaration(stmt)) {
    out.push(makeSymNode(stmt.name.text, 'interface', relPath, lang, hasExport(stmt), loc(stmt, sourceFile)));
  } else if (ts.isTypeAliasDeclaration(stmt)) {
    out.push(makeSymNode(stmt.name.text, 'type', relPath, lang, hasExport(stmt), loc(stmt, sourceFile)));
  } else if (ts.isEnumDeclaration(stmt)) {
    out.push(makeSymNode(stmt.name.text, 'enum', relPath, lang, hasExport(stmt), loc(stmt, sourceFile)));
  } else if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
    out.push(makeSymNode(stmt.name.text, 'module', relPath, lang, hasExport(stmt), loc(stmt, sourceFile)));
  }
  // export default function / class
  else if (
    ts.isExportAssignment(stmt) &&
    !stmt.isExportEquals &&
    ts.isIdentifier(stmt.expression)
  ) {
    // `export default someIdentifier` — not a new declaration, skip
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSymNode(
  name: string,
  kind: SymbolKind,
  relPath: string,
  lang: Language,
  exported: boolean,
  nodeLoc: { line: number; col: number } | undefined,
): Node {
  return {
    id: symbolId(relPath, name),
    kind: 'symbol',
    language: lang,
    name,
    symbolKind: kind,
    file: relPath,
    exported,
    ...(nodeLoc !== undefined ? { loc: nodeLoc } : {}),
  };
}

function hasExport(node: ts.Node): boolean {
  return (
    ts.getCombinedModifierFlags(node as ts.Declaration) &
      (ts.ModifierFlags.Export | ts.ModifierFlags.ExportDefault)
  ) !== 0;
}

function loc(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): { line: number; col: number } | undefined {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, col: character + 1 };
}

export function toRelPath(absolutePath: string, repoRoot: string): string {
  return path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
}

function detectLanguage(fileName: string): Language {
  if (fileName.endsWith('.ts') || fileName.endsWith('.tsx') || fileName.endsWith('.mts') || fileName.endsWith('.cts')) return 'ts';
  if (fileName.endsWith('.js') || fileName.endsWith('.jsx') || fileName.endsWith('.mjs') || fileName.endsWith('.cjs')) return 'js';
  return null;
}
