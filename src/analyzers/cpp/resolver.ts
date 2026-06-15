/**
 * STUB — replaced by analyze-cpp (cpp-1) when it lands on develop.
 *
 * This file exists only so that vitest can resolve the import path and apply
 * vi.mock() in test/analyzers/objc/conformance.test.ts. Real tests mock this
 * entire module; no method here runs in tests.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

export interface IncludeResolverConfig {
  repoRoot: string;
  config?: Record<string, unknown>;
}

export class IncludeResolver {
  constructor(_config: IncludeResolverConfig) {}

  resolve(_spec: string, _fromFile: string, _quoted: boolean): null {
    throw new Error('include resolver (cpp-1) not yet installed');
  }
}
