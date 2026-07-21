import type { RepoIndex, DepGraph } from "../types/index.js";

export interface Boundary {
  label: string;
  globs: string[];
  provenance: "inferred";
  instability: number; // Ce/(Ca+Ce), 0 = maximally stable
  crossEdges: Array<{ from: string; to: string; line?: number }>;
}

/** The label a file belongs to: its top-level directory under src/ (or "root"). */
function boundaryOf(relativePath: string): string {
  const p = relativePath.replace(/\\/g, "/");
  const m = p.match(/^src\/([^/]+)\//);
  if (m) return m[1];
  const top = p.split("/")[0];
  return top.includes(".") ? "root" : top;
}

/**
 * Infer boundaries from directory structure (measured), with Martin instability
 * and the exact cross-boundary edge list per boundary. No community detection.
 */
export function inferBoundaries(index: RepoIndex, graph: DepGraph): Boundary[] {
  const labelOf = new Map<string, string>();
  for (const f of index.files) labelOf.set(f.relativePath, boundaryOf(f.relativePath));

  const ce = new Map<string, number>(); // efferent: edges leaving the boundary
  const ca = new Map<string, number>(); // afferent: edges entering the boundary
  const cross = new Map<string, Boundary["crossEdges"]>();
  const globs = new Map<string, Set<string>>();

  for (const [file, label] of labelOf) {
    if (!globs.has(label)) globs.set(label, new Set());
    globs.get(label)!.add(`src/${label}/**`);
  }

  for (const edge of graph.edges) {
    const from = labelOf.get(edge.from);
    const to = labelOf.get(edge.to);
    if (!from || !to || from === to) continue;
    ce.set(from, (ce.get(from) ?? 0) + 1);
    ca.set(to, (ca.get(to) ?? 0) + 1);
    if (!cross.has(from)) cross.set(from, []);
    cross.get(from)!.push({ from: edge.from, to: edge.to, line: edge.line });
  }

  const labels = [...new Set(labelOf.values())].sort();
  return labels.map((label) => {
    const e = ce.get(label) ?? 0;
    const a = ca.get(label) ?? 0;
    return {
      label,
      globs: [...(globs.get(label) ?? [])],
      provenance: "inferred" as const,
      instability: e + a === 0 ? 0 : e / (e + a),
      crossEdges: cross.get(label) ?? [],
    };
  });
}
