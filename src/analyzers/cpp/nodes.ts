/**
 * Symbol node extraction for C/C++ — part of cpp-2 (issue #58).
 *
 * Extracts top-level function definitions, composite types, typedef names,
 * #define macros, C++ classes, namespaces, and templates.
 * Preprocessor conditionals are NOT evaluated — all branches are included.
 */

import type { TreeNode, Position } from '../tree-sitter/index.js';
import type { Node, Language, SymbolKind } from '../../graph/model.js';
import { symbolId } from '../../graph/node-id.js';

export type CppGrammarLanguage = 'c' | 'cpp';

/** Extract all top-level symbol nodes (does NOT include the file node itself). */
export function extractNodes(
  rootNode: TreeNode,
  filePath: string,
  language: CppGrammarLanguage,
): Node[] {
  const nodes: Node[] = [];
  const nameCounts = new Map<string, number>();

  function addSymbol(name: string, pos: Position, symbolKind: SymbolKind): void {
    const existing = nameCounts.get(name) ?? 0;
    nameCounts.set(name, existing + 1);
    const id = symbolId(filePath, existing > 0 ? `${name}_${existing}` : name);
    nodes.push({
      id,
      kind: 'symbol',
      language: language as Language,
      name,
      symbolKind,
      file: filePath,
      loc: { line: pos.row + 1, col: pos.column },
      exported: true,
    });
  }

  for (const child of rootNode.children) {
    extractTopLevel(child, language, addSymbol);
  }

  return nodes;
}

type SymbolAdder = (name: string, pos: Position, symbolKind: SymbolKind) => void;

function extractTopLevel(node: TreeNode, lang: CppGrammarLanguage, add: SymbolAdder): void {
  switch (node.type) {
    // ── Functions ──────────────────────────────────────────────────────────
    case 'function_definition': {
      const name = extractFunctionName(node.childForFieldName('declarator'));
      if (name) add(name, node.startPosition, 'function');
      break;
    }
    case 'declaration': {
      for (const decl of node.childrenForFieldName('declarator')) {
        const name = extractDeclaratorName(decl);
        if (name) add(name, decl.startPosition, 'variable');
      }
      break;
    }

    // ── Composite types ────────────────────────────────────────────────────
    case 'struct_specifier':
    case 'union_specifier': {
      const nameNode = node.childForFieldName('name');
      if (nameNode) add(nameNode.text, nameNode.startPosition, 'struct');
      break;
    }
    case 'enum_specifier': {
      const nameNode = node.childForFieldName('name');
      if (nameNode) add(nameNode.text, nameNode.startPosition, 'enum');
      break;
    }
    case 'type_definition': {
      for (const decl of node.childrenForFieldName('declarator')) {
        const name = extractDeclaratorName(decl);
        if (name) add(name, decl.startPosition, 'type');
      }
      break;
    }

    // ── Preprocessor ───────────────────────────────────────────────────────
    case 'preproc_def':
    case 'preproc_function_def': {
      const nameNode = node.childForFieldName('name');
      if (nameNode) add(nameNode.text, nameNode.startPosition, 'macro');
      break;
    }

    // ── C++ only ───────────────────────────────────────────────────────────
    case 'class_specifier': {
      if (lang === 'cpp') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) add(nameNode.text, nameNode.startPosition, 'class');
      }
      break;
    }
    case 'namespace_definition': {
      if (lang === 'cpp') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) add(nameNode.text, nameNode.startPosition, 'module');
        const body = node.childForFieldName('body');
        if (body) {
          for (const child of body.children) {
            extractTopLevel(child, lang, add);
          }
        }
      }
      break;
    }
    case 'template_declaration': {
      if (lang === 'cpp') {
        const last = node.namedChildren[node.namedChildren.length - 1];
        if (last) extractTopLevel(last, lang, add);
      }
      break;
    }

    // ── Transparent wrappers ───────────────────────────────────────────────
    case 'linkage_specification': {
      const body = node.childForFieldName('body');
      if (body) {
        for (const child of body.children) {
          extractTopLevel(child, lang, add);
        }
      }
      break;
    }

    case 'preproc_if':
    case 'preproc_ifdef':
    case 'preproc_elif':
    case 'preproc_else': {
      for (const child of node.namedChildren) {
        extractTopLevel(child, lang, add);
      }
      break;
    }

    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Declarator name helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractFunctionName(node: TreeNode | null): string | null {
  if (!node) return null;
  if (node.type === 'function_declarator') {
    return extractDeclaratorName(node.childForFieldName('declarator'));
  }
  return extractDeclaratorName(node);
}

function extractDeclaratorName(node: TreeNode | null): string | null {
  if (!node) return null;
  switch (node.type) {
    case 'identifier':
    case 'type_identifier':
    case 'field_identifier':
      return node.text;

    case 'pointer_declarator':
    case 'abstract_pointer_declarator':
      return extractDeclaratorName(node.namedChild(0));

    case 'reference_declarator':
    case 'rvalue_reference_declarator':
      return extractDeclaratorName(node.namedChild(0));

    case 'function_declarator':
      return extractDeclaratorName(node.childForFieldName('declarator'));

    case 'array_declarator':
    case 'init_declarator':
      return extractDeclaratorName(node.childForFieldName('declarator'));

    case 'scoped_identifier': {
      const name = node.childForFieldName('name');
      return name ? name.text : null;
    }
    case 'operator_name':
      return node.text;

    case 'destructor_name': {
      const inner = node.namedChild(0);
      return inner ? `~${inner.text}` : null;
    }

    default:
      return null;
  }
}

