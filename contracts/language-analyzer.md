# Contract: LanguageAnalyzer

> **Owner:** core stream (issue #6) — `src/analyzers/types.ts`
> **Status:** stub created by analyze-cpp stream; director should refine and own.

## Interface

```typescript
interface LanguageAnalyzer {
  readonly id: string;           // e.g. 'cpp', 'python'
  readonly version: number;      // monotonically increasing; bump on output-shape change
  readonly extensions: readonly string[];  // e.g. ['.c', '.h', '.cpp']
  analyzeFile(
    filePath: string,
    content: string,
    ctx: ProjectContext,
  ): Promise<AnalysisFragment>;
}

interface ProjectContext {
  projectRoot: string;               // absolute path
  configuredIncludeDirs?: string[];  // C/C++/ObjC extra search paths
  configuredSourceRoots?: string[];  // Python/TS extra source roots
}

interface AnalysisFragment {
  fileId: string;                // file:// node id of the analysed file
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  errors?: AnalysisError[];
}
```

## Scaffold section (tree-sitter — py-1, issue #49)

`src/analyzers/tree-sitter/index.ts` provides:

```typescript
// Load a grammar parser for 'c' or 'cpp'
createGrammarParser(language: 'c' | 'cpp'): Promise<GrammarParser>

// Hook type for include / module resolvers
type ResolverHook = (importPath: string, fromFile: string, isSystem: boolean) => Promise<string | null>
```

Current stub uses native `tree-sitter` bindings (CJS via `createRequire`).
The analyze-python stream will replace this with `web-tree-sitter` (WASM).

## Conformance requirements

Every analyzer must satisfy (see `test/conformance/shared.ts`):

1. Returns a file node with `id === fileNodeId(filePath)` and `kind === 'file'`
2. Top-level symbols appear as nodes with `kind === 'symbol'`
3. Unresolved imports → `ext:` nodes + `imports` edges to those nodes
4. In-project imports → `file://` nodes + `imports` edges
5. Deterministic: identical inputs always produce identical outputs
