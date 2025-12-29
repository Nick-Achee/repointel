import pc from "picocolors";
import * as path from "node:path";
import {
  sliceRoute,
  sliceFeature,
  generateContextPack,
  saveSlice,
  saveContextPack,
} from "../core/slicer.js";
import { visualizeSlice } from "../core/visualizer.js";
import { formatBytes, ensureDir } from "../core/utils.js";
import type { LLMModel } from "../types/index.js";

export interface SliceCommandOptions {
  route?: string;
  seeds?: string[];
  name?: string;
  depth?: string;
  maxBytes?: string;
  maxFileBytes?: string;
  exclude?: string[];
  output?: string;
  format?: "json" | "markdown" | "both";
  model?: LLMModel;
  maxTokens?: string;
  viz?: boolean;
}

export async function sliceCommand(options: SliceCommandOptions): Promise<void> {
  const root = process.cwd();
  const format = options.format || "both";
  const outputDir = options.output || path.join(root, ".repointel", "slices");

  if (!options.route && !options.seeds?.length) {
    console.error(pc.red("Error: Must specify --route or --seeds"));
    process.exit(1);
  }

  console.log(pc.cyan("\n📦 Building context slice...\n"));

  const sliceOptions = {
    root,
    depth: options.depth ? parseInt(options.depth, 10) : undefined,
    maxBytes: options.maxBytes ? parseInt(options.maxBytes, 10) : undefined,
    maxFileBytes: options.maxFileBytes ? parseInt(options.maxFileBytes, 10) : undefined,
    exclude: options.exclude,
    model: options.model,
    maxTokens: options.maxTokens ? parseInt(options.maxTokens, 10) : undefined,
  };

  let slice;
  let sliceName: string;

  if (options.route) {
    sliceName = options.route.replace(/\//g, "_").replace(/^_/, "") || "root";
    console.log(pc.dim(`  Route: ${options.route}`));
    slice = await sliceRoute(options.route, sliceOptions);
  } else {
    sliceName = options.name || "feature";
    console.log(pc.dim(`  Seeds: ${options.seeds!.join(", ")}`));
    slice = await sliceFeature(options.seeds!, sliceName, sliceOptions);
  }

  console.log(pc.dim(`  Depth: ${options.depth || 5}`));
  console.log(pc.dim(`  Format: ${format}`));

  ensureDir(outputDir);
  const outputs: string[] = [];

  // Save JSON
  if (format === "json" || format === "both") {
    const jsonPath = path.join(outputDir, `${sliceName}.json`);
    saveSlice(slice, jsonPath);
    outputs.push(jsonPath);
  }

  // Save Markdown context pack (with optional visualizations)
  if (format === "markdown" || format === "both") {
    let contextPack = await generateContextPack(slice, root);

    // Add visualizations if --viz flag is set
    if (options.viz) {
      console.log(pc.dim("  Generating visualizations..."));
      const viz = await visualizeSlice(slice, { root });

      contextPack += "\n---\n\n";
      contextPack += "## Architecture Diagrams\n\n";

      contextPack += "### Data Flow\n\n";
      contextPack += "Shows client-server data flow and API calls.\n\n";
      contextPack += "```mermaid\n" + viz.dataFlow + "\n```\n\n";

      contextPack += "### Architecture Layers\n\n";
      contextPack += "Shows UI, Logic, API, and Data layers.\n\n";
      contextPack += "```mermaid\n" + viz.architecture + "\n```\n\n";

      contextPack += "### Component Dependencies\n\n";
      contextPack += "Shows import relationships between components.\n\n";
      contextPack += "```mermaid\n" + viz.componentDeps + "\n```\n\n";
    }

    const mdPath = path.join(outputDir, `${sliceName}.md`);
    saveContextPack(contextPack, mdPath);
    outputs.push(mdPath);
  }

  // Print summary
  console.log("\n" + pc.cyan("━".repeat(50)));
  console.log(pc.bold(`📦 CONTEXT SLICE: ${slice.name}`));
  console.log(pc.cyan("━".repeat(50)));

  console.log(`  ${pc.dim("Type:")}       ${slice.type}`);
  console.log(`  ${pc.dim("Files:")}      ${slice.summary.totalFiles}`);
  console.log(`  ${pc.dim("Size:")}       ${formatBytes(slice.summary.totalBytes)}`);
  console.log(`  ${pc.dim("Tokens:")}     ~${slice.summary.totalTokens.toLocaleString()}`);
  console.log(`  ${pc.dim("Max Depth:")}  ${slice.summary.maxDepth}`);

  // Show token budget info if model was specified
  if (slice.tokenBudget) {
    console.log("");
    console.log(pc.bold(`  📊 Token Budget (${slice.tokenBudget.model}):`));
    console.log(`    ${pc.dim("Context:")}   ${slice.tokenBudget.contextWindow.toLocaleString()}`);
    console.log(`    ${pc.dim("Reserved:")}  ${slice.tokenBudget.reservedForOutput.toLocaleString()} (for output)`);
    console.log(`    ${pc.dim("Available:")} ${slice.tokenBudget.availableForInput.toLocaleString()}`);
    console.log(`    ${pc.dim("Used:")}      ${slice.tokenBudget.used.toLocaleString()} (${Math.round(slice.tokenBudget.used / slice.tokenBudget.availableForInput * 100)}%)`);
    console.log(`    ${pc.dim("Remaining:")} ${pc.green(slice.tokenBudget.remaining.toLocaleString())}`);
    if (slice.tokenBudget.estimatedCost !== undefined) {
      console.log(`    ${pc.dim("Est. Cost:")} $${slice.tokenBudget.estimatedCost.toFixed(4)}`);
    }
  }

  console.log("");
  console.log(pc.bold("  By Type:"));
  const typeEntries = Object.entries(slice.summary.byType)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);
  for (const [type, count] of typeEntries) {
    console.log(`    ${pc.dim(type.padEnd(12))} ${count}`);
  }

  if (slice.excluded.length > 0) {
    console.log("");
    console.log(pc.bold("  Excluded:"));
    const byReason = new Map<string, number>();
    for (const ex of slice.excluded) {
      byReason.set(ex.reason, (byReason.get(ex.reason) || 0) + 1);
    }
    for (const [reason, count] of byReason) {
      console.log(`    ${pc.dim(reason.padEnd(12))} ${count}`);
    }
  }

  console.log("");
  console.log(pc.bold("  Seed Files:"));
  for (const seed of slice.seedFiles.slice(0, 5)) {
    console.log(`    ${pc.dim("→")} ${seed}`);
  }
  if (slice.seedFiles.length > 5) {
    console.log(`    ${pc.dim(`... and ${slice.seedFiles.length - 5} more`)}`);
  }

  console.log("\n" + pc.cyan("━".repeat(50)));
  console.log(pc.green("✅ Generated:"));
  for (const output of outputs) {
    console.log(`   ${pc.dim("→")} ${output}`);
  }
  console.log(pc.cyan("━".repeat(50)) + "\n");
}
