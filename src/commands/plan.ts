import pc from "picocolors";
import * as path from "node:path";
import { buildPlan, renderPlan } from "../core/plan.js";
import { ensureDir } from "../core/utils.js";
import * as fs from "node:fs";

export interface PlanCommandOptions {
  goal: string;
  seeds: string[];
  root?: string;
  json?: boolean;
}

export async function planCommand(options: PlanCommandOptions): Promise<void> {
  const root = options.root || process.cwd();
  if (!options.seeds || options.seeds.length === 0) {
    console.error("plan requires --seeds <area> (files or directories).");
    process.exitCode = 2;
    return;
  }

  const plan = await buildPlan(options.goal, options.seeds, { root });

  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const slug =
    options.goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "plan";
  const plansDir = path.join(root, ".repointel", "plans");
  ensureDir(plansDir);
  const out = path.join(plansDir, `${slug}.md`);
  fs.writeFileSync(out, renderPlan(plan));

  console.log(pc.green(`\n  ✓ Feature Plan for "${options.goal}"`));
  console.log(pc.dim("    Observe/Orient/Decide filled from the graph; judgment sections are questions."));
  console.log(pc.dim("    Complete the Act contract, then: repointel contract check"));
  console.log(`\n  → ${pc.cyan(path.relative(root, out))}\n`);
}
