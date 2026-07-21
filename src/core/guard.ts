import type { RepoIndex, DepGraph } from "../types/index.js";
import { evaluateContract } from "./contract.js";
import {
  resolveLabels,
  compileRule,
  type ArchitecturePolicy,
} from "./policy.js";

export interface GuardViolation {
  rule: string;
  classification: "convergent" | "divergent";
  matches: string[];
  severity: "error" | "warning";
  provenance: "declared" | "inferred";
}

export interface GuardReport {
  ok: boolean; // true when no error-level violation
  violations: GuardViolation[];
  smells: Array<{ rule: string; detail: string; severity: "warning" }>;
  coverage: { unlabeled: string[] };
}

/** A rule is declared only if BOTH its endpoint labels are declared. */
function ruleProvenance(
  policy: ArchitecturePolicy,
  from: string,
  to: string
): "declared" | "inferred" {
  const decl = (label: string) =>
    policy.labels
      .filter((l) => l.label === label)
      .every((l) => l.provenance === "declared") &&
    policy.labels.some((l) => l.label === label);
  return decl(from) && decl(to) ? "declared" : "inferred";
}

export function evaluateGuard(
  policy: ArchitecturePolicy,
  index: RepoIndex,
  graph: DepGraph
): GuardReport {
  const files = index.files.map((f) => f.relativePath);
  const { unlabeled } = resolveLabels(policy, files);

  const violations: GuardViolation[] = [];
  for (const rule of policy.forbidden) {
    if (!rule.ratified) continue; // unratified rules are proposals, not gates
    const provenance = ruleProvenance(policy, rule.from, rule.to);
    const expectations = compileRule(policy, rule);
    const result = evaluateContract(
      { name: `${rule.from}->${rule.to}`, expect: expectations },
      index,
      graph
    );
    const divergent = result.results.filter(
      (r) => r.classification === "divergent"
    );
    const matches = divergent.flatMap((r) => r.matches ?? []);
    violations.push({
      rule: `${rule.from} must not ${rule.kind === "path" ? "reach" : "import"} ${rule.to}`,
      classification: matches.length > 0 ? "divergent" : "convergent",
      matches,
      // Provenance cap: an inferred rule can never be an error.
      severity:
        matches.length > 0 && provenance === "declared" ? "error" : "warning",
      provenance,
    });
  }

  // Smell: god-file by degree (fan-in + fan-out), heuristic, warning-only.
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const smells: GuardReport["smells"] = [];
  const threshold = Math.max(10, files.length / 3);
  for (const [file, d] of degree) {
    if (d > threshold)
      smells.push({
        rule: "god-file (high fan-in + fan-out)",
        detail: `${file} has degree ${d}`,
        severity: "warning",
      });
  }

  return {
    ok: !violations.some((v) => v.severity === "error"),
    violations,
    smells,
    coverage: { unlabeled },
  };
}
