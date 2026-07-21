import * as path from "node:path";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import { findDependents } from "./dep-graph.js";
import { sliceFeature } from "./slicer.js";
import { inferBoundaries, type Boundary } from "./understand.js";
import { evaluateGuard, type GuardReport } from "./guard.js";
import { derivePolicy, type ArchitecturePolicy } from "./policy.js";
import { readJson } from "./utils.js";

export interface PlanOptions {
  root?: string;
}

export interface FeaturePlan {
  goal: string;
  provenance: { observe: "measured"; orient: "inferred"; decide: "measured" };
  observe: {
    seedFiles: string[];
    files: Array<{ relativePath: string; rank?: number; reason: string }>;
    estimatedTokens: number;
    contextPack: string;
  };
  orient: {
    boundaries: Boundary[];
    questions: string[];
  };
  decide: {
    guard: GuardReport;
    impact: { affected: string[]; direct: string[]; transitive: string[] };
    questions: string[];
  };
  act: {
    contractTemplate: { name: string; expect: unknown[] };
    note: string;
  };
}

/**
 * Compose the SOP Feature Plan from graph facts. Deterministic sections are
 * filled with evidence; judgment sections are emitted as questions. This
 * function computes no new graph fact — it arranges what the pipeline produces.
 */
export async function buildPlan(
  goal: string,
  seeds: string[],
  options: PlanOptions = {}
): Promise<FeaturePlan> {
  const root = options.root || process.cwd();

  const index = await generateIndex({ root });
  const graph = await buildDepGraph({ root });

  // OBSERVE — the ranked seed slice (PageRank-ordered, seed first).
  const slice = await sliceFeature(seeds, "plan", { root });
  const contextPack = path.join(".repointel", "slices", "plan.md");

  // ORIENT — inferred boundaries; volatility/primitives are judgment.
  const boundaries = inferBoundaries(index, graph);
  const orientQuestions = [
    "Which of these boundaries are VOLATILE (likely to change) vs stable? The graph shows structure, not rate-of-change.",
    "What are the business PRIMITIVES this touches (actors, resources, actions, invariants)? Name them.",
  ];

  // DECIDE — guard report (use a committed policy if present, else derive one)
  // and the impact of the seed area.
  const policy =
    readJson<ArchitecturePolicy>(
      path.join(root, ".repointel", "architecture.json")
    ) ?? derivePolicy(index, graph);
  const guard = evaluateGuard(policy, index, graph);
  const impact = findDependents(graph, slice.seedFiles);
  const decideQuestions = [
    "Does this change respect the architecture (see guard violations/smells)? Which boundary owns the new behavior?",
    "What PATTERN, if any, does the volatility justify — or is a plain function enough? Add a pattern only for demonstrated design pressure.",
    "What INVARIANT must hold after the change? Express it as an expected graph delta below.",
  ];

  // ACT — a contract skeleton the human completes: expected deltas to verify.
  const contractTemplate = {
    name: goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    expect: [
      { kind: "file-exists", path: "src/<area>/<new-file>.ts", _note: "the file this change should create" },
      { kind: "export-exists", file: "src/<area>/<file>.ts", symbol: "<newExport>", _note: "the symbol it should add" },
      { kind: "edge-exists", from: "src/<area>/<file>.ts", to: "src/<dep>.ts", _note: "the dependency it should wire" },
    ],
  };

  return {
    goal,
    provenance: { observe: "measured", orient: "inferred", decide: "measured" },
    observe: {
      seedFiles: slice.seedFiles,
      files: slice.files.map((f) => ({
        relativePath: f.relativePath,
        rank: f.rank,
        reason: f.reason,
      })),
      estimatedTokens: slice.summary.totalTokens,
      contextPack,
    },
    orient: { boundaries, questions: orientQuestions },
    decide: {
      guard,
      impact: {
        affected: impact.all,
        direct: impact.direct,
        transitive: impact.transitive,
      },
      questions: decideQuestions,
    },
    act: {
      contractTemplate,
      note: "Complete this contract with the expected graph deltas for your change, then verify with `repointel contract check`. It is a necessary-condition gate, not a test — a stub satisfies structure.",
    },
  };
}

/** Render a FeaturePlan as a Markdown document (the SOP shape, graph-grounded). */
export function renderPlan(plan: FeaturePlan): string {
  const lines: string[] = [];
  lines.push(`# Feature Plan: ${plan.goal}`, "");
  lines.push(
    "> Deterministic sections are filled from the graph (provenance noted).",
    "> Questions are judgment the graph cannot answer — you fill them.",
    ""
  );

  // 1. Observe
  lines.push(`## 1. Observe (${plan.provenance.observe})`, "");
  lines.push(`Seed area: ${plan.observe.seedFiles.join(", ")}`);
  lines.push(`Context pack: ${plan.observe.contextPack} (~${plan.observe.estimatedTokens} tokens)`, "");
  lines.push("Most relevant files (PageRank-ranked):");
  for (const f of plan.observe.files.slice(0, 12)) {
    const r = f.rank !== undefined ? ` (rank ${f.rank.toFixed(3)})` : "";
    lines.push(`- ${f.relativePath}${r} — ${f.reason}`);
  }
  lines.push("");

  // 2. Orient
  lines.push(`## 2. Orient (${plan.provenance.orient})`, "");
  lines.push("Boundaries (directory-inferred, with instability I = Ce/(Ca+Ce)):");
  for (const b of plan.orient.boundaries) {
    lines.push(`- **${b.label}** — I=${b.instability.toFixed(2)}, ${b.crossEdges.length} cross-edge(s)`);
  }
  lines.push("", "Questions (judgment — the graph cannot answer these):");
  for (const q of plan.orient.questions) lines.push(`- ${q}`);
  lines.push("");

  // 3. Decide
  lines.push(`## 3. Decide (${plan.provenance.decide})`, "");
  const g = plan.decide.guard;
  lines.push(`Architecture fitness: ${g.ok ? "no error-level violations" : "ERROR-level violations present"}`);
  const divergent = g.violations.filter((v) => v.classification === "divergent");
  for (const v of divergent) lines.push(`- ${v.severity === "error" ? "✗" : "⚠"} ${v.rule} (${v.provenance})`);
  for (const s of g.smells.slice(0, 5)) lines.push(`- ⚠ smell: ${s.detail}`);
  lines.push(
    "",
    `Impact of the seed area: ${plan.decide.impact.affected.length} file(s) affected ` +
      `(${plan.decide.impact.direct.length} direct, ${plan.decide.impact.transitive.length} transitive).`,
    ""
  );
  lines.push("Questions (judgment):");
  for (const q of plan.decide.questions) lines.push(`- ${q}`);
  lines.push("");

  // 4. Act
  lines.push("## 4. Act", "");
  lines.push(plan.act.note, "");
  lines.push("```json");
  lines.push(JSON.stringify(plan.act.contractTemplate, null, 2));
  lines.push("```");

  return lines.join("\n");
}
