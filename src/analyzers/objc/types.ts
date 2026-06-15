/**
 * Minimal types describing what we expect from the tree-sitter scaffold (py-1)
 * and the include resolver (cpp-1). When those streams land these imports are
 * replaced by the real modules; the shapes here document the contract boundary.
 */

/** A single named capture returned by the scaffold's query runner. */
export interface CaptureResult {
  /** Capture name from the query (e.g. "interface", "quoted-import"). */
  name: string;
  /** Repo-relative path of the source file (passed through for context). */
  text: string;
  /** Zero-based source position of the captured node. */
  startPosition: { row: number; column: number };
}

/**
 * Result from the include resolver (cpp-1 / src/analyzers/cpp/resolver.ts).
 * Resolved paths are repo-relative; external targets carry the specifier.
 */
export type IncludeResolveResult =
  | { kind: 'file'; repoRelPath: string }
  | { kind: 'external'; spec: string };

/**
 * Minimal interface we call on the IncludeResolver from cpp-1.
 * The real class may expose more; we only use this surface.
 */
export interface IIncludeResolver {
  resolve(
    spec: string,
    fromFile: string,
    quoted: boolean,
  ): IncludeResolveResult | null;
}
