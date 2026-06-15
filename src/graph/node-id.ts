// STUB — core-2 (core stream) owns and will replace this.
// Matches contracts/graph-model.md node id format.

export function makeFileId(repoRelativePath: string): string {
  return `file:${repoRelativePath}`
}

export function makeSymId(repoRelativePath: string, symbolName: string, suffix = 0): string {
  const base = `sym:${repoRelativePath}#${symbolName}`
  return suffix === 0 ? base : `${base}~${suffix}`
}

export function makeExtId(language: string, spec: string): string {
  return `ext:${language}:${spec}`
}
