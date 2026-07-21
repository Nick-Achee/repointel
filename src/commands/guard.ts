import pc from "picocolors";
import * as path from "node:path";
import { generateIndex } from "../core/indexer.js";
import { buildDepGraph } from "../core/dep-graph.js";
import { readJson } from "../core/utils.js";
import { evaluateGuard } from "../core/guard.js";
import type { ArchitecturePolicy } from "../core/policy.js";

export interface GuardCheckOptions {
  root?: string;
  json?: boolean;
}

export async function guardCheck(options: GuardCheckOptions = {}): Promise<void> {
  const root = options.root || process.cwd();
  const policyPath = path.join(root, ".repointel", "architecture.json");
  const policy = readJson<ArchitecturePolicy>(policyPath);
  if (!policy) {
    console.error(`No policy at ${path.relative(root, policyPath)}. Run: repointel teach init`);
    process.exitCode = 2;
    return;
  }

  const index = await generateIndex({ root });
  const graph = await buildDepGraph({ root });
  const report = evaluateGuard(policy, index, graph);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  console.log(pc.bold("\n  Architecture fitness\n"));
  for (const v of report.violations) {
    if (v.classification !== "divergent") continue;
    const tag = v.severity === "error" ? pc.red("✗ error") : pc.yellow("⚠ warn");
    console.log(`  ${tag}  ${v.rule} (${v.provenance})`);
    for (const m of v.matches.slice(0, 5)) console.log(pc.dim(`         ${m}`));
  }
  for (const s of report.smells) console.log(`  ${pc.yellow("⚠ smell")} ${s.detail}`);
  if (report.coverage.unlabeled.length > 0)
    console.log(`  ${pc.yellow("⚠ coverage")} ${report.coverage.unlabeled.length} unlabeled file(s)`);
  console.log(report.ok ? pc.green("\n  ✓ no error-level violations\n") : pc.red("\n  ✗ error-level violations present\n"));

  process.exitCode = report.ok ? 0 : 1;
}
