/**
 * Test helpers: fixture builder for CaptureResult arrays and a stub resolver.
 */

import type { CaptureResult, IIncludeResolver } from '../../../src/analyzers/objc/types.js';

/** Quickly build a CaptureResult. col defaults to 0. */
export function cap(
  name: string,
  text: string,
  row: number,
  col = 0,
): CaptureResult {
  return { name, text, startPosition: { row, col } };
}

/** Stub resolver that tracks calls and returns configurable results. */
export class StubResolver implements IIncludeResolver {
  private rules: Map<string, { kind: 'file'; repoRelPath: string } | { kind: 'external'; spec: string } | null> =
    new Map();
  public calls: Array<{ spec: string; fromFile: string; quoted: boolean }> = [];

  /** Register a rule: resolve(spec) → result (or null = not found). */
  addRule(
    spec: string,
    result: { kind: 'file'; repoRelPath: string } | { kind: 'external'; spec: string } | null,
  ): this {
    this.rules.set(spec, result);
    return this;
  }

  resolve(spec: string, fromFile: string, quoted: boolean) {
    this.calls.push({ spec, fromFile, quoted });
    return this.rules.get(spec) ?? null;
  }
}
