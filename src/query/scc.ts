/**
 * Tarjan's Strongly Connected Components algorithm.
 *
 * Given a list of node IDs and a successor function, returns all SCCs as
 * arrays of node IDs. Each SCC is a maximal set of nodes where every node is
 * reachable from every other node.
 *
 * - SCCs of size > 1 are multi-node cycles.
 * - SCCs of size == 1 may still contain a self-loop (the caller must check).
 */
export function tarjanSCC(
  nodes: string[],
  getSuccessors: (nodeId: string) => string[],
): string[][] {
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  function strongconnect(v: string): void {
    idx.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);

    for (const w of getSuccessors(v)) {
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }

    if (low.get(v) === idx.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(component);
    }
  }

  for (const n of nodes) {
    if (!idx.has(n)) {
      strongconnect(n);
    }
  }

  return components;
}

/**
 * Find one example cycle path within an SCC.
 *
 * For a single-node self-loop, returns [node, node].
 * For a multi-node SCC, returns a path [start, ...intermediates, start]
 * demonstrating the cycle. The start node is the lexicographically smallest
 * node in the SCC for determinism.
 *
 * Successors are sorted before traversal, ensuring deterministic output.
 */
export function findExampleCyclePath(
  sccNodes: string[],
  getSuccessors: (nodeId: string) => string[],
): string[] {
  if (sccNodes.length === 0) return [];

  const sorted = sccNodes.slice().sort();
  const start = sorted[0]!;

  // Self-loop: single node that points to itself
  if (sccNodes.length === 1) {
    return [start, start];
  }

  const sccSet = new Set(sccNodes);
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(v: string): boolean {
    visited.add(v);
    path.push(v);

    const successors = getSuccessors(v)
      .filter((w) => sccSet.has(w))
      .sort();

    for (const w of successors) {
      if (w === start && v !== start) {
        // Completed the cycle back to start
        path.push(start);
        return true;
      }
      if (!visited.has(w) && dfs(w)) {
        return true;
      }
    }

    path.pop();
    return false;
  }

  dfs(start);
  return path;
}
