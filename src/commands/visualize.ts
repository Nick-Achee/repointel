import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  sliceRoute,
  sliceFeature,
} from "../core/slicer.js";
import {
  visualizeSlice,
  buildDataFlowGraph,
  dataFlowToMermaid,
  architectureToMermaid,
  requestFlowToMermaid,
  componentDepsToMermaid,
} from "../core/visualizer.js";
import { ensureDir } from "../core/utils.js";
import type { LLMModel } from "../types/index.js";

export interface VisualizeCommandOptions {
  route?: string;
  seeds?: string[];
  name?: string;
  depth?: string;
  diagram?: "all" | "dataflow" | "architecture" | "sequence" | "components";
  direction?: "TD" | "LR";
  output?: string;
  format?: "mermaid" | "svg" | "both";
}

export async function visualizeCommand(options: VisualizeCommandOptions): Promise<void> {
  const root = process.cwd();
  const outputDir = options.output || path.join(root, ".repointel", "diagrams");
  const diagram = options.diagram || "all";
  const direction = (options.direction || "TD") as "TD" | "LR";
  const format = options.format || "mermaid";

  if (!options.route && !options.seeds?.length) {
    console.error(pc.red("Error: Must specify --route or --seeds"));
    process.exit(1);
  }

  console.log(pc.cyan("\n📊 Generating visualizations...\n"));

  // Build slice first
  const sliceOptions = {
    root,
    depth: options.depth ? parseInt(options.depth, 10) : 5,
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

  console.log(pc.dim(`  Files: ${slice.files.length}`));
  console.log(pc.dim(`  Diagram: ${diagram}`));
  console.log(pc.dim(`  Direction: ${direction}`));

  // Build visualization
  const viz = await visualizeSlice(slice, { root, direction });
  ensureDir(outputDir);

  const outputs: string[] = [];

  // Generate requested diagrams
  if (diagram === "all" || diagram === "dataflow") {
    const content = viz.dataFlow;
    const filePath = path.join(outputDir, `${sliceName}_dataflow.mmd`);
    fs.writeFileSync(filePath, content);
    outputs.push(filePath);
  }

  if (diagram === "all" || diagram === "architecture") {
    const content = viz.architecture;
    const filePath = path.join(outputDir, `${sliceName}_architecture.mmd`);
    fs.writeFileSync(filePath, content);
    outputs.push(filePath);
  }

  if (diagram === "all" || diagram === "sequence") {
    const content = viz.requestFlow;
    const filePath = path.join(outputDir, `${sliceName}_sequence.mmd`);
    fs.writeFileSync(filePath, content);
    outputs.push(filePath);
  }

  if (diagram === "all" || diagram === "components") {
    const content = viz.componentDeps;
    const filePath = path.join(outputDir, `${sliceName}_components.mmd`);
    fs.writeFileSync(filePath, content);
    outputs.push(filePath);
  }

  // Print summary
  console.log("\n" + pc.cyan("━".repeat(50)));
  console.log(pc.bold("📊 VISUALIZATION SUMMARY"));
  console.log(pc.cyan("━".repeat(50)));

  console.log(`  ${pc.dim("Slice:")}      ${slice.name}`);
  console.log(`  ${pc.dim("Nodes:")}      ${viz.graph.nodes.length}`);
  console.log(`  ${pc.dim("Edges:")}      ${viz.graph.edges.length}`);

  console.log("");
  console.log(pc.bold("  Layers:"));
  console.log(`    ${pc.dim("UI:")}         ${viz.graph.layers.ui.length} nodes`);
  console.log(`    ${pc.dim("Logic:")}      ${viz.graph.layers.logic.length} nodes`);
  console.log(`    ${pc.dim("API:")}        ${viz.graph.layers.api.length} nodes`);
  console.log(`    ${pc.dim("Data:")}       ${viz.graph.layers.data.length} nodes`);

  // Show edge breakdown
  const edgesByType = new Map<string, number>();
  for (const edge of viz.graph.edges) {
    edgesByType.set(edge.type, (edgesByType.get(edge.type) || 0) + 1);
  }

  if (edgesByType.size > 0) {
    console.log("");
    console.log(pc.bold("  Data Flows:"));
    for (const [type, count] of edgesByType) {
      const icon = type === "query" ? "📥" : type === "mutation" ? "📤" : type === "fetch" ? "🌐" : "📎";
      console.log(`    ${icon} ${pc.dim(type.padEnd(12))} ${count}`);
    }
  }

  console.log("\n" + pc.cyan("━".repeat(50)));
  console.log(pc.green("✅ Generated:"));
  for (const output of outputs) {
    console.log(`   ${pc.dim("→")} ${output}`);
  }
  console.log(pc.cyan("━".repeat(50)));

  // Print preview of one diagram
  if (outputs.length > 0) {
    console.log("");
    console.log(pc.bold("Preview (dataflow):"));
    console.log(pc.dim("─".repeat(40)));
    const preview = viz.dataFlow.split("\n").slice(0, 20).join("\n");
    console.log(pc.dim(preview));
    if (viz.dataFlow.split("\n").length > 20) {
      console.log(pc.dim("..."));
    }
    console.log(pc.dim("─".repeat(40)));
  }

  console.log("");
  console.log(pc.dim("Tip: Open .mmd files in VS Code with Mermaid extension"));
  console.log(pc.dim("     or paste into https://mermaid.live"));
  console.log("");
}
