import { matchesPattern } from "./utils.js";
import type { Expectation } from "./contract.js";
import type { RepoIndex, DepGraph } from "../types/index.js";
import { inferBoundaries } from "./understand.js";

export interface PolicyLabel {
  label: string;
  include: string[];
  exclude?: string[];
  provenance: "declared" | "inferred";
}

export interface PolicyRule {
  from: string;               // label
  to: string;                 // label
  kind: "edge" | "path";
  dependencyType?: "any" | "runtime";
  ratified: boolean;
}

export interface ArchitecturePolicy {
  version: string;
  labels: PolicyLabel[];
  forbidden: PolicyRule[];
  entrypoints: string[];
}

/**
 * Map each file to at most one label (first matching label wins) and collect
 * files that match no label. O(files x labels), computed once per guard run.
 */
export function resolveLabels(
  policy: ArchitecturePolicy,
  files: string[]
): { labelOf: Map<string, string>; unlabeled: string[] } {
  const labelOf = new Map<string, string>();
  const unlabeled: string[] = [];
  for (const file of files) {
    let matched: string | undefined;
    for (const l of policy.labels) {
      const inc = l.include.some((g) => matchesPattern(file, g));
      const exc = (l.exclude ?? []).some((g) => matchesPattern(file, g));
      if (inc && !exc) {
        matched = l.label;
        break;
      }
    }
    if (matched) labelOf.set(file, matched);
    else unlabeled.push(file);
  }
  return { labelOf, unlabeled };
}

/** Expand a label->label rule into wedge expectations over the label globs. */
export function compileRule(
  policy: ArchitecturePolicy,
  rule: PolicyRule
): Expectation[] {
  const globsFor = (label: string) =>
    policy.labels.filter((l) => l.label === label).flatMap((l) => l.include);
  const fromGlobs = globsFor(rule.from);
  const toGlobs = globsFor(rule.to);
  const out: Expectation[] = [];
  for (const from of fromGlobs) {
    for (const to of toGlobs) {
      out.push(
        rule.kind === "path"
          ? { kind: "path-forbidden", from, to }
          : { kind: "edge-forbidden", from, to }
      );
    }
  }
  return out;
}

/**
 * Derive a candidate policy from the current graph: directory labels (inferred)
 * plus every directional invariant the code already satisfies (from -> to where
 * no edge from-label -> to-label exists), proposed unratified.
 */
export function derivePolicy(index: RepoIndex, graph: DepGraph): ArchitecturePolicy {
  const boundaries = inferBoundaries(index, graph);
  const labels: PolicyLabel[] = boundaries.map((b) => ({
    label: b.label,
    include: b.globs,
    provenance: "inferred",
  }));

  // Which label->label directions currently have at least one edge?
  const existing = new Set<string>();
  const labelOf = new Map<string, string>();
  for (const b of boundaries) {
    for (const f of index.files) {
      // Use the same glob matcher guard uses, so derive's candidate rules and
      // guard's evaluation label every file identically.
      if (b.globs.some((g) => matchesPattern(f.relativePath, g)))
        labelOf.set(f.relativePath, b.label);
    }
  }
  for (const e of graph.edges) {
    const f = labelOf.get(e.from);
    const t = labelOf.get(e.to);
    if (f && t && f !== t) existing.add(`${f} -> ${t}`);
  }

  const names = boundaries.map((b) => b.label);
  const forbidden: PolicyRule[] = [];
  for (const from of names) {
    for (const to of names) {
      if (from === to) continue;
      // Propose forbidding a direction only if the code already satisfies it.
      if (!existing.has(`${from} -> ${to}`)) {
        forbidden.push({ from, to, kind: "edge", ratified: false });
      }
    }
  }

  return { version: "1.0.0", labels, forbidden, entrypoints: [] };
}
