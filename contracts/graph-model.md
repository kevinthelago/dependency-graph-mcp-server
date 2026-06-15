# Contract: Graph Model

> **Owner:** core stream (issue #3) — `src/graph/model.ts`, `src/graph/node-id.ts`
> **Status:** stub created by analyze-cpp stream; director should refine and own.

## Node types

```typescript
type NodeKind = 'file' | 'symbol' | 'external';

interface DependencyNode {
  id: string;           // stable opaque id (see Node ID format below)
  kind: NodeKind;
  path?: string;        // absolute path; present on file nodes
  name?: string;        // symbol or external import name
  language?: string;    // e.g. 'c', 'cpp', 'python'; present on file nodes
  exported?: boolean;   // present on symbol nodes
  loc?: Span;           // source span; present on symbol nodes
}
```

## Edge types

```typescript
type EdgeKind = 'imports' | 'declares' | 'references';

interface DependencyEdge {
  src: string;   // source node id
  dst: string;   // destination node id
  kind: EdgeKind;
  loc?: Loc;     // origin location in the source file
}
```

## Node ID format

| Kind | Format | Example |
|------|--------|---------|
| file | `file://` + absolute path (forward slashes) | `file:///home/user/proj/src/main.c` |
| symbol | `sym://` + absolute path + `#` + name (+ `$N` suffix for overloads) | `sym:///home/user/proj/src/lib.c#add` |
| external | `ext:` + include/import path as written | `ext:stdio.h`, `ext:boost/filesystem.hpp` |

**Collision suffixing:** when multiple top-level symbols share the same name (e.g. overloaded functions), a `$2`, `$3`, … suffix is appended deterministically in declaration order.

## Helpers (`src/graph/node-id.ts`)

```typescript
fileNodeId(absolutePath: string): string
symbolNodeId(filePath: string, name: string, suffix?: number): string
externalNodeId(includePath: string): string
```
