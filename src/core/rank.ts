/**
 * Personalized PageRank over the file import graph — the production-proven
 * approach to ranking code by relevance to a set of seed files (Aider's repo
 * map). Importance flows from the seeds along importer->imported edges, so a
 * file the seeds depend on transitively, and that many of their dependencies
 * share, ranks highest. Cache-safe: pure function of its inputs.
 */

export interface RankEdge {
  from: string;
  to: string;
  /** Edge weight (default 1). Aider uses sqrt(#references); we pass #bindings. */
  weight?: number;
}

export interface RankOptions {
  /** Damping factor (probability of following an edge vs teleporting) */
  damping?: number;
  maxIterations?: number;
  tolerance?: number;
}

/**
 * Compute personalized PageRank. Returns a rank in (0,1] per node, summing to 1.
 */
export function personalizedPageRank(
  nodes: string[],
  edges: RankEdge[],
  seeds: string[],
  options: RankOptions = {}
): Map<string, number> {
  const damping = options.damping ?? 0.85;
  const maxIterations = options.maxIterations ?? 100;
  const tolerance = options.tolerance ?? 1e-8;

  const n = nodes.length;
  const rank = new Map<string, number>();
  if (n === 0) return rank;

  const nodeSet = new Set(nodes);

  // Personalization vector: mass on the seeds present in the graph, else uniform.
  const seedNodes = seeds.filter((s) => nodeSet.has(s));
  const personalize = new Map<string, number>();
  if (seedNodes.length > 0) {
    for (const s of seedNodes) personalize.set(s, 1 / seedNodes.length);
  } else {
    for (const node of nodes) personalize.set(node, 1 / n);
  }
  const teleport = (node: string) => personalize.get(node) ?? 0;

  // Weighted out-adjacency, normalized to transition probabilities per node.
  const outWeight = new Map<string, number>();
  const outEdges = new Map<string, Array<{ to: string; w: number }>>();
  for (const edge of edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) continue;
    const w = edge.weight && edge.weight > 0 ? edge.weight : 1;
    outWeight.set(edge.from, (outWeight.get(edge.from) ?? 0) + w);
    const list = outEdges.get(edge.from) ?? [];
    list.push({ to: edge.to, w });
    outEdges.set(edge.from, list);
  }

  // Initialize at the personalization distribution.
  for (const node of nodes) rank.set(node, teleport(node));

  for (let iter = 0; iter < maxIterations; iter++) {
    const next = new Map<string, number>();
    for (const node of nodes) next.set(node, (1 - damping) * teleport(node));

    // Dangling mass (nodes with no out-edges) redistributes via personalization.
    let danglingMass = 0;
    for (const node of nodes) {
      if (!outEdges.has(node)) danglingMass += rank.get(node)!;
    }
    if (danglingMass > 0) {
      for (const node of nodes) {
        next.set(
          node,
          next.get(node)! + damping * danglingMass * teleport(node)
        );
      }
    }

    // Push each node's rank along its normalized out-edges.
    for (const [from, list] of outEdges) {
      const total = outWeight.get(from)!;
      const share = damping * rank.get(from)!;
      for (const { to, w } of list) {
        next.set(to, next.get(to)! + (share * w) / total);
      }
    }

    let delta = 0;
    for (const node of nodes) delta += Math.abs(next.get(node)! - rank.get(node)!);
    for (const node of nodes) rank.set(node, next.get(node)!);
    if (delta < tolerance) break;
  }

  return rank;
}
