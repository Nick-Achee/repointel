import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import { generateIndex } from "../core/indexer.js";
import { buildDepGraph } from "../core/dep-graph.js";
import { ensureDir, readJson, writeJson } from "../core/utils.js";
import {
  evaluateContract,
  snapshotGraph,
  diffSnapshots,
  deriveContractFromDiff,
  type Contract,
  type GraphSnapshot,
} from "../core/contract.js";

export interface ContractCommandOptions {
  action: "check" | "snapshot" | "diff";
  file?: string;
  name?: string;
  json?: boolean;
  includeTests?: boolean;
}

function snapshotPath(root: string, name: string): string {
  return path.join(root, ".repointel", "snapshots", `${name}.json`);
}

export async function contractCommand(
  options: ContractCommandOptions
): Promise<void> {
  const root = process.cwd();
  const name = options.name || "current";
  const opts = { root, includeTests: options.includeTests };

  if (options.action === "check") {
    if (!options.file) {
      console.error(pc.red("  contract check needs a contract file path."));
      process.exitCode = 2;
      return;
    }
    const contract = readJson<Contract>(path.resolve(root, options.file));
    if (!contract || !Array.isArray(contract.expect)) {
      console.error(pc.red(`  Not a valid contract: ${options.file}`));
      process.exitCode = 2;
      return;
    }

    const index = await generateIndex(opts);
    const graph = await buildDepGraph(opts);
    const result = evaluateContract(contract, index, graph);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printResult(result);
    }
    // CI/hook gate: non-zero when the contract is not satisfied.
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (options.action === "snapshot") {
    const index = await generateIndex(opts);
    const graph = await buildDepGraph(opts);
    const snap = snapshotGraph(graph, index);
    const out = snapshotPath(root, name);
    writeJson(out, snap);
    console.log(
      pc.green(
        `  ✓ Snapshot "${name}": ${snap.files.length} files, ${snap.edges.length} edges, ${snap.exports.length} exports`
      )
    );
    console.log(pc.dim(`    → ${path.relative(root, out)}`));
    return;
  }

  if (options.action === "diff") {
    const before = readJson<GraphSnapshot>(snapshotPath(root, name));
    if (!before) {
      console.error(
        pc.red(`  No snapshot "${name}". Run: repointel contract snapshot --name ${name}`)
      );
      process.exitCode = 2;
      return;
    }
    const index = await generateIndex(opts);
    const graph = await buildDepGraph(opts);
    const after = snapshotGraph(graph, index);
    const diff = diffSnapshots(before, after);

    if (options.json) {
      console.log(JSON.stringify(diff, null, 2));
      return;
    }

    const line = (label: string, items: string[], color: (s: string) => string) => {
      if (items.length === 0) return;
      console.log(color(`  ${label} (${items.length}):`));
      for (const i of items.slice(0, 30)) console.log(`    ${i}`);
    };
    line("+ files", diff.addedFiles, pc.green);
    line("- files", diff.removedFiles, pc.red);
    line("+ edges", diff.addedEdges, pc.green);
    line("- edges", diff.removedEdges, pc.red);
    line("+ exports", diff.addedExports, pc.green);
    line("- exports", diff.removedExports, pc.red);
    const total =
      diff.addedFiles.length +
      diff.removedFiles.length +
      diff.addedEdges.length +
      diff.removedEdges.length +
      diff.addedExports.length +
      diff.removedExports.length;
    if (total === 0) console.log(pc.dim("  No structural changes since snapshot."));

    // Offer the derived contract as a starting point.
    if (diff.addedFiles.length + diff.addedEdges.length > 0) {
      const derived = deriveContractFromDiff(name, diff);
      const contractPath = path.join(
        root,
        ".repointel",
        "contracts",
        `${name}.derived.json`
      );
      ensureDir(path.dirname(contractPath));
      writeJson(contractPath, derived);
      console.log(
        pc.dim(
          `\n  Derived expected-delta contract → ${path.relative(root, contractPath)}`
        )
      );
    }
    return;
  }
}

function printResult(result: ReturnType<typeof evaluateContract>): void {
  const glyph = { convergent: pc.green("✓"), absent: pc.red("✗"), divergent: pc.yellow("!") };
  console.log(pc.bold(`\n  Contract: ${result.contract}`));
  for (const r of result.results) {
    console.log(`  ${glyph[r.classification]} ${r.detail}`);
  }
  console.log(
    pc.dim(
      `\n  ${result.summary.satisfied} satisfied, ${result.summary.absent} missing, ${result.summary.violated} violated`
    )
  );
  console.log(result.ok ? pc.green("  CONTRACT SATISFIED") : pc.red("  CONTRACT FAILED"));
}
