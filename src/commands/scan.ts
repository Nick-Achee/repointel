import pc from "picocolors";
import { generateIndex, saveIndex } from "../core/indexer.js";
import { formatBytes } from "../core/utils.js";
import { detectSpecKit } from "../core/speckit.js";
import type { ScanOptions } from "../types/index.js";

export interface ScanCommandOptions {
  refresh?: boolean;
  include?: string[];
  exclude?: string[];
  output?: string;
}

export async function scanCommand(options: ScanCommandOptions): Promise<void> {
  const root = process.cwd();

  console.log(pc.cyan("\n🔍 Scanning repository...\n"));
  console.log(pc.dim(`  Root: ${root}`));

  const scanOptions: ScanOptions = {
    root,
    refresh: options.refresh,
    include: options.include,
    exclude: options.exclude,
  };

  const index = await generateIndex(scanOptions);
  const outputPath = saveIndex(index, options.output);

  // Print summary
  console.log("\n" + pc.cyan("━".repeat(50)));
  console.log(pc.bold("📊 REPOSITORY INDEX"));
  console.log(pc.cyan("━".repeat(50)));

  if (index.gitCommit) {
    console.log(`  ${pc.dim("Git:")}        ${index.gitCommit.slice(0, 8)}`);
  }
  if (index.gitBranch) {
    console.log(`  ${pc.dim("Branch:")}     ${index.gitBranch}`);
  }

  // Show detected frameworks
  if (index.frameworks.length > 0) {
    console.log("");
    console.log(pc.bold("  Frameworks:"));
    for (const fw of index.frameworks) {
      const config = fw.configFile ? pc.dim(` (${fw.configFile})`) : "";
      console.log(`    ${pc.green("✓")} ${fw.name}${config}`);
    }
  }

  // Show detected specs
  if (index.specs.length > 0) {
    console.log("");
    console.log(pc.bold("  Specs/Contracts:"));
    for (const spec of index.specs) {
      console.log(`    ${pc.blue("◆")} ${spec.type} ${pc.dim(`(${spec.files.length} files)`)}`);
    }
  }

  // Show SpecKit status
  const speckit = await detectSpecKit(root);
  if (speckit) {
    console.log("");
    console.log(pc.bold("  SpecKit:"));
    console.log(`    ${pc.green("✓")} .specify/ detected`);
    console.log(`    ${pc.dim("Features:")}     ${speckit.features.length}`);
    if (speckit.features.length > 0) {
      const latest = speckit.features[speckit.features.length - 1];
      console.log(`    ${pc.dim("Latest:")}       ${latest.id}`);
    }
  }

  console.log("");

  console.log(pc.bold("  Files by Type:"));
  const typeEntries = Object.entries(index.summary.byType)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  for (const [type, count] of typeEntries) {
    console.log(`    ${pc.dim(type.padEnd(12))} ${count}`);
  }

  console.log("");
  console.log(pc.bold("  Rendering:"));
  console.log(`    ${pc.dim("Client:")}     ${index.summary.clientComponents}`);
  console.log(`    ${pc.dim("Server:")}     ${index.summary.serverComponents}`);

  console.log("");
  console.log(pc.bold("  Data Usage:"));
  console.log(`    ${pc.dim("useQuery:")}   ${index.summary.totalDataUsage.useQuery}`);
  console.log(`    ${pc.dim("useMutation:")} ${index.summary.totalDataUsage.useMutation}`);
  console.log(`    ${pc.dim("fetch:")}      ${index.summary.totalDataUsage.fetch}`);

  console.log("");
  console.log(pc.bold("  Top Hooks:"));
  const hookEntries = Object.entries(index.summary.totalHooks)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  for (const [hook, count] of hookEntries) {
    console.log(`    ${pc.dim(hook.padEnd(16))} ${count}`);
  }

  // Show anti-patterns if any detected
  const antiPatternEntries = Object.entries(index.summary.totalAntiPatterns)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  if (antiPatternEntries.length > 0) {
    console.log("");
    console.log(pc.bold(pc.yellow("  ⚠️  Anti-Patterns Detected:")));
    for (const [pattern, count] of antiPatternEntries) {
      console.log(`    ${pc.yellow("!")} ${pc.dim(pattern.padEnd(18))} ${count}`);
    }
  }

  console.log("");
  console.log(`  ${pc.dim("Total Size:")}  ${formatBytes(index.summary.totalSizeBytes)}`);
  console.log(`  ${pc.dim("Total Files:")} ${index.summary.totalFiles}`);

  console.log("\n" + pc.cyan("━".repeat(50)));
  console.log(pc.green(`✅ Saved to: ${outputPath}`));
  console.log(pc.cyan("━".repeat(50)) + "\n");
}
