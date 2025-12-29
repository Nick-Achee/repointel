import pc from "picocolors";
import * as path from "node:path";
import {
  buildDepGraph,
  buildDepGraphFromSeeds,
  saveDepGraph,
  depGraphToMermaid,
} from "../core/dep-graph.js";
import {
  buildRouteGraph,
  saveRouteGraph,
  routeGraphToMermaid,
} from "../core/route-graph.js";
import {
  buildApiGraph,
  saveApiGraph,
  apiGraphToMermaid,
} from "../core/api-graph.js";
import { ensureDir } from "../core/utils.js";
import * as fs from "node:fs";

export interface GraphCommandOptions {
  type: "deps" | "routes" | "api" | "all";
  seeds?: string[];
  depth?: string;
  format?: "json" | "mermaid" | "both";
  output?: string;
}

export async function graphCommand(options: GraphCommandOptions): Promise<void> {
  const root = process.cwd();
  const format = options.format || "json";
  const outputDir = options.output || path.join(root, ".repointel", "graphs");

  console.log(pc.cyan("\n📊 Building graphs...\n"));
  console.log(pc.dim(`  Root: ${root}`));
  console.log(pc.dim(`  Type: ${options.type}`));
  console.log(pc.dim(`  Format: ${format}`));

  ensureDir(outputDir);

  const outputs: string[] = [];

  // Build dependency graph
  if (options.type === "deps" || options.type === "all") {
    console.log(pc.dim("\n  Building dependency graph..."));

    const depGraph = options.seeds?.length
      ? await buildDepGraphFromSeeds(options.seeds, {
          root,
          depth: options.depth ? parseInt(options.depth, 10) : undefined,
        })
      : await buildDepGraph({ root });

    if (format === "json" || format === "both") {
      const jsonPath = saveDepGraph(depGraph, path.join(outputDir, "deps.json"));
      outputs.push(jsonPath);
    }

    if (format === "mermaid" || format === "both") {
      const mermaid = depGraphToMermaid(depGraph);
      const mermaidPath = path.join(outputDir, "deps.mmd");
      fs.writeFileSync(mermaidPath, mermaid);
      outputs.push(mermaidPath);
    }

    // Print summary
    console.log(pc.dim("\n  Dependency Graph Stats:"));
    console.log(`    ${pc.dim("Nodes:")}     ${depGraph.stats.totalNodes}`);
    console.log(`    ${pc.dim("Edges:")}     ${depGraph.stats.totalEdges}`);
    console.log(`    ${pc.dim("External:")}  ${depGraph.stats.externalDeps}`);
    console.log(`    ${pc.dim("Circular:")}  ${depGraph.stats.circularDeps}`);
    if (depGraph.stats.maxDeps.file) {
      console.log(
        `    ${pc.dim("Most deps:")} ${path.basename(depGraph.stats.maxDeps.file)} (${depGraph.stats.maxDeps.count})`
      );
    }
  }

  // Build route graph
  if (options.type === "routes" || options.type === "all") {
    console.log(pc.dim("\n  Building route graph..."));

    const routeGraph = await buildRouteGraph({ root });

    if (format === "json" || format === "both") {
      const jsonPath = saveRouteGraph(routeGraph, path.join(outputDir, "routes.json"));
      outputs.push(jsonPath);
    }

    if (format === "mermaid" || format === "both") {
      const mermaid = routeGraphToMermaid(routeGraph);
      const mermaidPath = path.join(outputDir, "routes.mmd");
      fs.writeFileSync(mermaidPath, mermaid);
      outputs.push(mermaidPath);
    }

    // Print summary
    console.log(pc.dim("\n  Route Graph Stats:"));
    console.log(`    ${pc.dim("Framework:")} ${routeGraph.framework}`);
    console.log(`    ${pc.dim("Routes:")}    ${routeGraph.stats.totalRoutes}`);
    console.log(`    ${pc.dim("Layouts:")}   ${routeGraph.stats.totalLayouts}`);
    console.log(`    ${pc.dim("API:")}       ${routeGraph.stats.apiRoutes}`);
    console.log(`    ${pc.dim("Dynamic:")}   ${routeGraph.stats.dynamicRoutes}`);
    console.log(`    ${pc.dim("Client:")}    ${routeGraph.stats.clientPages}`);
    console.log(`    ${pc.dim("Server:")}    ${routeGraph.stats.serverPages}`);
  }

  // Build API graph
  if (options.type === "api" || options.type === "all") {
    console.log(pc.dim("\n  Building API graph..."));

    const apiGraph = await buildApiGraph({ root });

    if (format === "json" || format === "both") {
      const jsonPath = saveApiGraph(apiGraph, path.join(outputDir, "api.json"));
      outputs.push(jsonPath);
    }

    if (format === "mermaid" || format === "both") {
      const mermaid = apiGraphToMermaid(apiGraph);
      const mermaidPath = path.join(outputDir, "api.mmd");
      fs.writeFileSync(mermaidPath, mermaid);
      outputs.push(mermaidPath);
    }

    // Print summary
    console.log(pc.dim("\n  API Graph Stats:"));
    console.log(`    ${pc.dim("Total:")}     ${apiGraph.stats.totalEndpoints}`);
    console.log(`    ${pc.dim("Convex:")}    ${apiGraph.stats.byType.convex}`);
    console.log(`    ${pc.dim("REST:")}      ${apiGraph.stats.byType.rest}`);
    console.log(`    ${pc.dim("tRPC:")}      ${apiGraph.stats.byType.trpc}`);
    console.log(`    ${pc.dim("GraphQL:")}   ${apiGraph.stats.byType.graphql}`);
    console.log(`    ${pc.dim("Public:")}    ${apiGraph.stats.publicEndpoints}`);
    console.log(`    ${pc.dim("Protected:")} ${apiGraph.stats.protectedEndpoints}`);
  }

  console.log("\n" + pc.cyan("━".repeat(50)));
  console.log(pc.green("✅ Generated:"));
  for (const output of outputs) {
    console.log(`   ${pc.dim("→")} ${output}`);
  }
  console.log(pc.cyan("━".repeat(50)) + "\n");
}
