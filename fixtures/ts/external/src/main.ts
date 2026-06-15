// External package imports — these resolve to node_modules (external leaves)
// or remain unresolved if not installed.
import type { ZodSchema } from 'zod';
import { something } from 'nonexistent-package-xyz';

export function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  return schema.parse(input);
}

export function useSomething(): string {
  return String(something);
}
