import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import { sliceRoute } from "../core/slicer.js";
import { buildDepGraphFromSeeds, depGraphToMermaid } from "../core/dep-graph.js";
import { generateHealPrompt, type HealContext } from "../generators/heal.js";
import { ensureDir, readFileSafe } from "../core/utils.js";

export interface HealCommandOptions {
  route: string;
  spec: string;
  drift: string;
  depth?: string;
  output?: string;
  refresh?: boolean;
}

export async function healCommand(options: HealCommandOptions): Promise<void> {
  const root = process.cwd();
  const outputDir = options.output || path.join(root, ".repointel", "prompts");

  console.log(pc.cyan("\n🩹 Generating Heal Prompt...\n"));
  console.log(pc.dim(`  Route: ${options.route}`));
  console.log(pc.dim(`  Spec:  ${options.spec}`));
  console.log(pc.dim(`  Drift: ${options.drift}`));

  // Load the spec file
  const specPath = path.isAbsolute(options.spec)
    ? options.spec
    : path.join(root, options.spec);

  const specContent = readFileSafe(specPath);
  if (!specContent) {
    console.error(pc.red(`\n❌ Spec file not found: ${specPath}`));
    process.exit(1);
  }

  // Load the drift report
  const driftPath = path.isAbsolute(options.drift)
    ? options.drift
    : path.join(root, options.drift);

  const driftContent = readFileSafe(driftPath);
  if (!driftContent) {
    console.error(pc.red(`\n❌ Drift report not found: ${driftPath}`));
    console.error(pc.dim("\n  First run an audit to generate the drift report:"));
    console.error(
      pc.dim(`  repointel audit --route ${options.route} --spec ${options.spec}`)
    );
    process.exit(1);
  }

  console.log(pc.dim(`  Spec loaded: ${specContent.length} bytes`));
  console.log(pc.dim(`  Drift loaded: ${driftContent.length} bytes`));

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

  // Read source files for context
  console.log(pc.dim("  Reading source files..."));
  const sourceFiles: { path: string; content: string }[] = [];
  for (const file of slice.files) {
    const fullPath = path.join(root, file.relativePath);
    const content = readFileSafe(fullPath);
    if (content) {
      sourceFiles.push({ path: file.relativePath, content });
    }
  }

  // Generate prompt
  console.log(pc.dim("  Generating prompt..."));
  const context: HealContext = {
    slice,
    depMermaid,
    specContent,
    driftContent,
    sourceFiles,
  };

  const prompt = generateHealPrompt(context);

  // Write output
  ensureDir(outputDir);
  const routeSlug =
    options.route
      .replace(/^\//, "")
      .replace(/\//g, "-")
      .replace(/[^a-zA-Z0-9-]/g, "_") || "root";

  const promptPath = path.join(outputDir, `${routeSlug}_HEAL.prompt.txt`);
  fs.writeFileSync(promptPath, prompt);

  console.log("\n" + pc.cyan("━".repeat(50)));
  console.log(pc.green("✅ Heal prompt generated:"));
  console.log(`   ${pc.dim("→")} ${promptPath}`);
  console.log(pc.cyan("━".repeat(50)));

  console.log(pc.bold("\n📝 Next steps:"));
  console.log("  1. Feed this prompt to your LLM of choice");
  console.log("  2. Review the generated fixes");
  console.log("  3. Apply the fixes to your codebase");
  console.log(
    `  4. Re-run the audit to verify: repointel audit --route ${options.route} --spec ${options.spec}\n`
  );
}
