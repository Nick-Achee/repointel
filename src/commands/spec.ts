import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import { sliceRoute } from "../core/slicer.js";
import { buildApiGraph } from "../core/api-graph.js";
import { buildDepGraphFromSeeds, depGraphToMermaid } from "../core/dep-graph.js";
import { generateSpecPrompt, type SpecContext } from "../generators/spec.js";
import { ensureDir } from "../core/utils.js";

export interface SpecCommandOptions {
  route: string;
  depth?: string;
  output?: string;
  refresh?: boolean;
}

export async function specCommand(options: SpecCommandOptions): Promise<void> {
  const root = process.cwd();
  const outputDir = options.output || path.join(root, ".repointel", "prompts");

  console.log(pc.cyan("\n📋 Generating Spec Prompt...\n"));
  console.log(pc.dim(`  Route: ${options.route}`));

  // Slice the route
  console.log(pc.dim("  Slicing route..."));
  const slice = await sliceRoute(options.route, {
    root,
    depth: options.depth ? parseInt(options.depth, 10) : 3,
  });

  // Build dependency graph from seed files
  console.log(pc.dim("  Building dependency graph..."));
  const depGraph = await buildDepGraphFromSeeds(slice.seedFiles, {
    root,
    depth: 3,
  });
  const depMermaid = depGraphToMermaid(depGraph, { maxNodes: 30 });

  // Build API graph
  console.log(pc.dim("  Building API graph..."));
  const apiGraph = await buildApiGraph({ root });

  // Generate prompt
  console.log(pc.dim("  Generating prompt..."));
  const context: SpecContext = {
    slice,
    apiGraph,
    depGraph,
    depMermaid,
  };

  const prompt = generateSpecPrompt(context);

  // Write output
  ensureDir(outputDir);
  const routeSlug =
    options.route
      .replace(/^\//, "")
      .replace(/\//g, "-")
      .replace(/[^a-zA-Z0-9-]/g, "_") || "root";

  const promptPath = path.join(outputDir, `${routeSlug}_GENERATE_SPEC.prompt.txt`);
  fs.writeFileSync(promptPath, prompt);

  console.log("\n" + pc.cyan("━".repeat(50)));
  console.log(pc.green("✅ Spec prompt generated:"));
  console.log(`   ${pc.dim("→")} ${promptPath}`);
  console.log(pc.cyan("━".repeat(50)));

  console.log(pc.bold("\n📝 Next steps:"));
  console.log("  1. Feed this prompt to your LLM of choice");
  console.log("  2. Review and save the output as SPEC.md");
  console.log(`  3. Run: repointel audit --route ${options.route} --spec ./SPEC.md\n`);
}
