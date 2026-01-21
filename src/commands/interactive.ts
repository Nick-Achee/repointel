import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import { select, input, confirm } from "@inquirer/prompts";
import { scanCommand } from "./scan.js";
import { graphCommand } from "./graph.js";
import { sliceCommand } from "./slice.js";
import { specCommand } from "./spec.js";
import { auditCommand } from "./audit.js";
import { healCommand } from "./heal.js";
import { evalCommand } from "./eval.js";

interface InteractiveState {
  root: string;
  hasIndex: boolean;
  hasRoutes: boolean;
  routes: string[];
}

async function getState(): Promise<InteractiveState> {
  const root = process.cwd();
  const indexPath = path.join(root, ".repointel", "index.json");
  const routesPath = path.join(root, ".repointel", "graphs", "routes.json");

  const hasIndex = fs.existsSync(indexPath);
  let hasRoutes = false;
  let routes: string[] = [];

  if (fs.existsSync(routesPath)) {
    hasRoutes = true;
    try {
      const routeGraph = JSON.parse(fs.readFileSync(routesPath, "utf-8"));
      routes = routeGraph.routes
        ?.filter((r: any) => r.type === "page")
        ?.map((r: any) => r.path) || [];
    } catch {
      // ignore
    }
  }

  return { root, hasIndex, hasRoutes, routes };
}

async function runScan(): Promise<void> {
  console.log("");
  await scanCommand({});
}

async function runGraphs(state: InteractiveState): Promise<void> {
  const graphType = await select({
    message: "Which graph do you want to build?",
    choices: [
      { name: "Dependencies (file imports)", value: "deps" },
      { name: "Routes (Next.js pages/layouts)", value: "routes" },
      { name: "API (Convex, REST endpoints)", value: "api" },
      { name: "All graphs", value: "all" },
    ],
  });

  const format = await select({
    message: "Output format?",
    choices: [
      { name: "JSON only", value: "json" },
      { name: "Mermaid diagrams only", value: "mermaid" },
      { name: "Both JSON and Mermaid", value: "both" },
    ],
  });

  console.log("");
  await graphCommand({ type: graphType as any, format: format as any });
}

async function runSlice(state: InteractiveState): Promise<void> {
  const sliceType = await select({
    message: "How do you want to slice?",
    choices: [
      { name: "By route path (e.g., /dashboard/events)", value: "route" },
      { name: "By seed files (custom file list)", value: "seeds" },
    ],
  });

  if (sliceType === "route") {
    let routePath: string;

    if (state.routes.length > 0) {
      const useExisting = await confirm({
        message: `Found ${state.routes.length} routes. Select from list?`,
        default: true,
      });

      if (useExisting) {
        routePath = await select({
          message: "Select a route:",
          choices: state.routes.slice(0, 20).map((r) => ({ name: r, value: r })),
        });
      } else {
        routePath = await input({
          message: "Enter route path:",
          default: "/",
        });
      }
    } else {
      routePath = await input({
        message: "Enter route path:",
        default: "/",
      });
    }

    const depth = await input({
      message: "Max import depth?",
      default: "5",
    });

    console.log("");
    await sliceCommand({ route: routePath, depth });
  } else {
    const seedsInput = await input({
      message: "Enter seed files (comma-separated):",
      default: "src/app/page.tsx",
    });

    const seeds = seedsInput.split(",").map((s) => s.trim());
    const name = await input({
      message: "Name for this slice:",
      default: "feature",
    });

    console.log("");
    await sliceCommand({ seeds, name });
  }
}

async function runSpecWorkflow(state: InteractiveState): Promise<void> {
  console.log(pc.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(pc.bold("  Spec → Audit → Heal Workflow"));
  console.log(pc.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  const step = await select({
    message: "Which step are you on?",
    choices: [
      {
        name: "1. Generate SPEC prompt (start here)",
        value: "spec",
        description: "Create a prompt to generate route specification",
      },
      {
        name: "2. Audit implementation against spec",
        value: "audit",
        description: "Compare implementation to SPEC.md",
      },
      {
        name: "3. Generate fixes for drift",
        value: "heal",
        description: "Create fixes from DRIFT_REPORT.md",
      },
    ],
  });

  // Get route
  let routePath: string;
  if (state.routes.length > 0) {
    routePath = await select({
      message: "Select a route to work with:",
      choices: [
        ...state.routes.slice(0, 15).map((r) => ({ name: r, value: r })),
        { name: "[ Enter custom path ]", value: "__custom__" },
      ],
    });

    if (routePath === "__custom__") {
      routePath = await input({
        message: "Enter route path:",
        default: "/",
      });
    }
  } else {
    routePath = await input({
      message: "Enter route path:",
      default: "/",
    });
  }

  if (step === "spec") {
    console.log("");
    await specCommand({ route: routePath });

    console.log(pc.yellow("\n📋 Next: Feed the generated prompt to your LLM"));
    console.log(pc.yellow("   Save the output as SPEC.md, then run this wizard again"));
    console.log(pc.yellow("   and choose 'Audit implementation'\n"));
  } else if (step === "audit") {
    const specPath = await input({
      message: "Path to SPEC.md file:",
      default: "./SPEC.md",
    });

    if (!fs.existsSync(path.join(state.root, specPath))) {
      console.log(pc.red(`\n❌ File not found: ${specPath}`));
      console.log(pc.dim("   Run step 1 first to generate a spec.\n"));
      return;
    }

    console.log("");
    await auditCommand({ route: routePath, spec: specPath });

    console.log(pc.yellow("\n📋 Next: Feed the generated prompt to your LLM"));
    console.log(pc.yellow("   Save the output as DRIFT_REPORT.md, then run this wizard"));
    console.log(pc.yellow("   again and choose 'Generate fixes'\n"));
  } else if (step === "heal") {
    const specPath = await input({
      message: "Path to SPEC.md file:",
      default: "./SPEC.md",
    });

    const driftPath = await input({
      message: "Path to DRIFT_REPORT.md file:",
      default: "./DRIFT_REPORT.md",
    });

    if (!fs.existsSync(path.join(state.root, specPath))) {
      console.log(pc.red(`\n❌ Spec file not found: ${specPath}\n`));
      return;
    }

    if (!fs.existsSync(path.join(state.root, driftPath))) {
      console.log(pc.red(`\n❌ Drift report not found: ${driftPath}`));
      console.log(pc.dim("   Run step 2 first to generate a drift report.\n"));
      return;
    }

    console.log("");
    await healCommand({ route: routePath, spec: specPath, drift: driftPath });

    console.log(pc.yellow("\n📋 Next: Feed the generated prompt to your LLM"));
    console.log(pc.yellow("   Apply the suggested fixes to your codebase"));
    console.log(pc.yellow("   Then re-run audit to verify the fixes worked!\n"));
  }
}

export async function interactiveCommand(): Promise<void> {
  console.log(pc.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(pc.bold("  🔍 repointel - Interactive Mode"));
  console.log(pc.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  const state = await getState();

  // Show current state
  console.log(pc.dim(`  Repository: ${state.root}`));
  console.log(pc.dim(`  Index: ${state.hasIndex ? pc.green("✓") : pc.yellow("not found")}`));
  console.log(pc.dim(`  Routes: ${state.hasRoutes ? pc.green(`${state.routes.length} found`) : pc.yellow("not scanned")}`));
  console.log("");

  // If no index, suggest scanning first
  if (!state.hasIndex) {
    const shouldScan = await confirm({
      message: "No index found. Scan repository first?",
      default: true,
    });

    if (shouldScan) {
      await runScan();
      // Refresh state after scan
      const newState = await getState();
      Object.assign(state, newState);
    }
  }

  // Main action selection
  const action = await select({
    message: "What would you like to do?",
    choices: [
      {
        name: "📊 Build graphs (deps, routes, API)",
        value: "graphs",
        description: "Generate dependency, route, or API graphs",
      },
      {
        name: "📦 Create context slice",
        value: "slice",
        description: "Extract focused context for LLM prompts",
      },
      {
        name: "📋 Spec/Audit/Heal workflow",
        value: "spec-workflow",
        description: "Generate specs, audit implementation, fix drift",
      },
      {
        name: "🔄 Re-scan repository",
        value: "scan",
        description: "Regenerate the repository index",
      },
      {
        name: "✅ Validate artifacts",
        value: "eval",
        description: "Check generated artifacts for consistency",
      },
      {
        name: "❌ Exit",
        value: "exit",
      },
    ],
  });

  switch (action) {
    case "graphs":
      await runGraphs(state);
      break;
    case "slice":
      await runSlice(state);
      break;
    case "spec-workflow":
      await runSpecWorkflow(state);
      break;
    case "scan":
      await runScan();
      break;
    case "eval":
      console.log("");
      await evalCommand({});
      break;
    case "exit":
      console.log(pc.dim("\nGoodbye!\n"));
      return;
  }

  // Ask to continue
  console.log("");
  const continueSession = await confirm({
    message: "Do something else?",
    default: true,
  });

  if (continueSession) {
    await interactiveCommand();
  } else {
    console.log(pc.dim("\nGoodbye!\n"));
  }
}
