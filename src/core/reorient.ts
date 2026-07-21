import * as path from "node:path";
import { generateIndex } from "./indexer.js";
import { buildDepGraph, findDependents } from "./dep-graph.js";
import { evaluateGuard, type GuardReport } from "./guard.js";
import { derivePolicy, type ArchitecturePolicy } from "./policy.js";
import { expandSeeds } from "./dep-graph.js";
import { readJson } from "./utils.js";

export interface ReorientOptions {
  root?: string;
}

export interface Reorientation {
  trigger: string;
  provenance: "measured";
  current: {
    guard: GuardReport;
    impact: { affected: string[]; direct: string[]; transitive: string[] };
  };
  questions: string[];
}

/**
 * Compose the SOP Reorientation Plan: current graph state (measured) plus the
 * drift-classification and smallest-safe-correction as questions. A composer —
 * it computes no new graph fact.
 */
export async function buildReorientation(
  trigger: string,
  seeds: string[],
  options: ReorientOptions = {}
): Promise<Reorientation> {
  const root = options.root || process.cwd();

  const index = await generateIndex({ root });
  const graph = await buildDepGraph({ root });

  const policy =
    readJson<ArchitecturePolicy>(
      path.join(root, ".repointel", "architecture.json")
    ) ?? derivePolicy(index, graph);
  const guard = evaluateGuard(policy, index, graph);

  const targets = expandSeeds(seeds, index);
  const impact = findDependents(graph, targets);

  return {
    trigger,
    provenance: "measured",
    current: {
      guard,
      impact: {
        affected: impact.all,
        direct: impact.direct,
        transitive: impact.transitive,
      },
    },
    questions: [
      "Classify the drift (the fix lives in the layer of the type): PRD / domain / data-model / CONTRACT (FE/BE shapes disagree) / PERMISSION / UI-state / test / architecture. Which is it?",
      "What is the single SOURCE OF TRUTH for that layer? Fix it there once — not the symptom in three places.",
      "What is the SMALLEST SAFE correction, and what test would have caught this (add it)?",
    ],
  };
}

/** Render a Reorientation as Markdown (SOP §21 shape). */
export function renderReorientation(r: Reorientation): string {
  const lines: string[] = [];
  lines.push(`# Reorientation: ${r.trigger}`, "");
  lines.push("> Current state is filled from the graph; classification and the correction are yours.", "");
  lines.push(`## Current state (${r.provenance})`, "");
  const g = r.current.guard;
  lines.push(`Architecture fitness: ${g.ok ? "no error-level violations" : "ERROR-level violations present"}`);
  for (const v of g.violations.filter((x) => x.classification === "divergent"))
    lines.push(`- ${v.severity === "error" ? "✗" : "⚠"} ${v.rule} (${v.provenance})`);
  lines.push(
    "",
    `Impact of the area: ${r.current.impact.affected.length} file(s) affected ` +
      `(${r.current.impact.direct.length} direct, ${r.current.impact.transitive.length} transitive).`,
    ""
  );
  lines.push("## Questions (judgment — reorient before adding code)", "");
  for (const q of r.questions) lines.push(`- ${q}`);
  return lines.join("\n");
}
