# Contract: LanguageAnalyzer

> **Owner:** core stream (issue #6) — `src/analyzers/types.ts`
> **Status:** implemented

## Interface

```typescript
// src/analyzers/types.ts

interface LanguageAnalyzer {
  readonly id: string;                    // e.g. 'typescript', 'python', 'cpp'
  readonly version: string;               // semver string; bump on output-shape change
  readonly extensions: string[];          // e.g. ['.ts', '.tsx']
  init(project: ProjectContext): Promise<void>;
  analyzeFile(filePath: string, text: string): Promise<AnalysisFragment>;
  dispose(): Promise<void>;
}

interface ProjectContext {
  repoRoot: string;                       // absolute repo root path
  config: Record<string, unknown>;        // language-specific config (tsconfig path, source roots, etc.)
  resolveExternal(spec: string): ExternalRef | null;
}

interface ExternalRef {
  id: string;                             // opaque: "ext:<language>:<spec>"
}

interface AnalysisFragment {
  file: Node;                             // the file node itself
  symbols: Node[];                        // top-level symbols declared in the file
  edges: Edge[];                          // all dependency edges from this file
  imports: ImportRef[];                   // raw import statements (pre-resolution)
}

interface Node {
  id: string;                             // "file:<path>" | "sym:<path>#<name>" | "ext:<lang>:<spec>"
  kind: "file" | "symbol" | "external";
  language: Language | null;
  name: string;
  symbolKind?: SymbolKind;
  file?: string;                          // repo-relative path for symbol nodes
  loc?: { line: number; col: number };
  exported?: boolean;
}

interface Edge {
  from: string;                           // source node id
  to: string;                             // target node id
  kind: "import" | "reference";
  targetType: "file" | "symbol" | "external";
  typeOnly?: boolean;
  wildcard?: boolean;
  resolution: "resolved" | "unresolved";
  loc?: { line: number; col: number };
}

interface ImportRef {
  specifier: string;                      // raw import string
  resolvedPath?: string;
  isExternal?: boolean;
  isUnresolved?: boolean;
  wildcard?: boolean;
  resolution?: "resolved" | "unresolved";
}
```

## Analyzer registry

`src/analyzers/registry.ts` provides the `AnalyzerRegistry` class:

```typescript
class AnalyzerRegistry {
  register(analyzer: LanguageAnalyzer): void;
  forExtension(ext: string): LanguageAnalyzer | undefined;
  forId(id: string): LanguageAnalyzer | undefined;
  all(): LanguageAnalyzer[];
}
```

## Node-id format

| Node type | Format | Example |
|-----------|--------|---------|
| File | `file:<repo-relative-path>` | `file:src/utils/foo.ts` |
| Symbol | `sym:<repo-relative-path>#<name>` | `sym:src/utils/foo.ts#MyClass` |
| External | `ext:<language>:<specifier>` | `ext:typescript:react` |

Use `makeFileId(path)`, `makeSymId(path, name, seen?)`, `makeExtId(lang, spec)` from `src/graph/node-id.ts`.

## Tree-sitter scaffold

`src/analyzers/tree-sitter/index.ts` provides:

```typescript
createGrammarParser(language: string): Promise<GrammarParser>

type ResolverHook = (importPath: string, fromFile: string, isSystem: boolean) => Promise<string | null>
```

Uses `web-tree-sitter` (WASM) for cross-platform grammar parsing.

## Conformance requirements

Every analyzer must satisfy (`test/conformance/harness.ts`):

1. `fragment.file.kind === "file"` and `fragment.file.id.match(/^file:/)`
2. `fragment.file.id` is stable (identical across two calls with same input)
3. Symbol nodes: `kind === "symbol"`, `id.match(/^sym:/)`, `file === filePath`
4. Symbol ordering deterministic across two calls
5. Edge ordering deterministic across two calls
6. All edges have non-empty `from`, `to`, `kind ∈ {import, reference}`, `resolution ∈ {resolved, unresolved}`
7. Empty input produces a valid file node (no crash)
