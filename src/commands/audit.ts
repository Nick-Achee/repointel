import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import { sliceRoute } from "../core/slicer.js";
import { buildApiGraph } from "../core/api-graph.js";
import { buildDepGraphFromSeeds, depGraphToMermaid } from "../core/dep-graph.js";
import { generateAuditPrompt, type AuditContext } from "../generators/audit.js";
import { ensureDir, readFileSafe } from "../core/utils.js";

export interface AuditCommandOptions {
  route: string;
  spec: string;
  depth?: string;
  output?: string;
  refresh?: boolean;
}

export async function auditCommand(options: AuditCommandOptions): Promise<void> {
  const root = process.cwd();
  const outputDir = options.output || path.join(root, ".repointel", "prompts");

  console.log(pc.cyan("\n🔍 Generating Audit Prompt...\n"));
  console.log(pc.dim(`  Route: ${options.route}`));
  console.log(pc.dim(`  Spec:  ${options.spec}`));

  // Load the spec file
  const specPath = path.isAbsolute(options.spec)
    ? options.spec
    : path.join(root, options.spec);

  const specContent = readFileSafe(specPath);
  if (!specContent) {
    console.error(pc.red(`\n❌ Spec file not found: ${specPath}`));
    console.error(pc.dim("\n  First generate a spec with:"));
    console.error(pc.dim(`  repointel spec --route ${options.route}`));
    process.exit(1);
  }

  console.log(pc.dim(`  Spec loaded: ${specContent.length} bytes`));

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
  const context: AuditContext = {
    slice,
    apiGraph,
    depMermaid,
    specContent,
  };

  const prompt = generateAuditPrompt(context);

  // Write output
  ensureDir(outputDir);
  const routeSlug =
    options.route
      .replace(/^\//, "")
      .replace(/\//g, "-")
      .replace(/[^a-zA-Z0-9-]/g, "_") || "root";

  const promptPath = path.join(outputDir, `${routeSlug}_AUDIT.prompt.txt`);
  fs.writeFileSync(promptPath, prompt);

  console.log("\n" + pc.cyan("━".repeat(50)));
  console.log(pc.green("✅ Audit prompt generated:"));
  console.log(`   ${pc.dim("→")} ${promptPath}`);
  console.log(pc.cyan("━".repeat(50)));

  console.log(pc.bold("\n📝 Next steps:"));
  console.log("  1. Feed this prompt to your LLM of choice");
  console.log("  2. Save the output as DRIFT_REPORT.md");
  console.log(
    `  3. Run: repointel heal --route ${options.route} --spec ${options.spec} --drift ./DRIFT_REPORT.md\n`
  );
}
