import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import { buildReorientation, renderReorientation } from "../core/reorient.js";
import { ensureDir } from "../core/utils.js";

export interface ReorientCommandOptions {
  trigger: string;
  seeds: string[];
  root?: string;
}

export async function reorientCommand(options: ReorientCommandOptions): Promise<void> {
  const root = options.root || process.cwd();
  if (!options.seeds || options.seeds.length === 0) {
    console.error("reorient requires --seeds <area> (the files involved in the miss).");
    process.exitCode = 2;
    return;
  }

  const r = await buildReorientation(options.trigger, options.seeds, { root });
  ensureDir(path.join(root, ".repointel"));
  const out = path.join(root, ".repointel", "reorient.md");
  fs.writeFileSync(out, renderReorientation(r));

  console.log(pc.green(`\n  ✓ Reorientation for "${options.trigger}"`));
  console.log(pc.dim("    Current state from the graph; classify the drift and fix at the source of truth."));
  console.log(`\n  → ${pc.cyan(path.relative(root, out))}\n`);
}
