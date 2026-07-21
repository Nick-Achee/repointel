import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import { buildDrift, renderDrift } from "../core/drift.js";
import { ensureDir } from "../core/utils.js";

export interface DriftCommandOptions {
  since: string;
  root?: string;
  json?: boolean;
}

export async function driftCommand(options: DriftCommandOptions): Promise<void> {
  const root = options.root || process.cwd();
  const drift = await buildDrift(options.since, { root });

  if (options.json) {
    console.log(JSON.stringify(drift, null, 2));
    if (drift.error) process.exitCode = 2;
    return;
  }

  if (drift.error) {
    console.error(drift.error);
    process.exitCode = 2;
    return;
  }

  ensureDir(path.join(root, ".repointel"));
  const out = path.join(root, ".repointel", "drift.md");
  fs.writeFileSync(out, renderDrift(drift));

  const d = drift.diff;
  console.log(pc.green(`\n  ✓ Drift since ${options.since}`));
  console.log(pc.dim(`    +${d.addedFiles.length}/-${d.removedFiles.length} files, +${d.addedEdges.length}/-${d.removedEdges.length} edges, +${d.addedExports.length}/-${d.removedExports.length} exports`));
  if (drift.crossBoundaryEdges.length > 0)
    console.log(pc.yellow(`    ⚠ ${drift.crossBoundaryEdges.length} new cross-boundary edge(s)`));
  console.log(`\n  → ${pc.cyan(path.relative(root, out))}\n`);
}
