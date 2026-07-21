import { matchesPattern } from "./utils.js";
import type { Expectation } from "./contract.js";

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
