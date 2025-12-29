#!/usr/bin/env node
import { Command } from "commander";
import { scanCommand } from "../commands/scan.js";
import { graphCommand } from "../commands/graph.js";
import { evalCommand } from "../commands/eval.js";
import { sliceCommand } from "../commands/slice.js";
import { specCommand } from "../commands/spec.js";
import { auditCommand } from "../commands/audit.js";
import { healCommand } from "../commands/heal.js";
import { interactiveCommand } from "../commands/interactive.js";
import { visualizeCommand } from "../commands/visualize.js";
import { specifyCommand } from "../commands/specify.js";
import { oodaCommand } from "../commands/ooda.js";

const program = new Command();

program
  .name("repointel")
  .description("Repo intelligence CLI - architecture graphs, context slices, and LLM-ready artifacts")
  .version("0.1.0");

// Default action: run interactive mode if no command specified
program.action(() => {
  interactiveCommand();
});

// repointel i / repointel interactive
program
  .command("i")
  .alias("interactive")
  .description("Interactive wizard mode (step-by-step prompts)")
  .action(interactiveCommand);

// repointel scan
program
  .command("scan")
  .description("Scan repository and generate index.json")
  .option("-r, --refresh", "Force regeneration even if index exists")
  .option("-i, --include <patterns...>", "Additional glob patterns to include")
  .option("-e, --exclude <patterns...>", "Glob patterns to exclude")
  .option("-o, --output <dir>", "Output directory (default: .repointel)")
  .action(scanCommand);

// repointel graph
program
  .command("graph")
  .description("Build dependency, route, and/or API graphs")
  .requiredOption("-t, --type <type>", "Graph type: deps, routes, api, or all")
  .option("-s, --seeds <files...>", "Seed files for scoped dependency graph")
  .option("-d, --depth <n>", "Max traversal depth for seeded graph", "10")
  .option("-f, --format <format>", "Output format: json, mermaid, or both", "json")
  .option("-o, --output <dir>", "Output directory (default: .repointel/graphs)")
  .action(graphCommand);

// repointel eval
program
  .command("eval")
  .description("Validate generated artifacts")
  .option("-t, --target <file>", "Specific artifact file to validate")
  .option("--strict", "Fail on warnings too")
  .action(evalCommand);

// repointel slice
program
  .command("slice")
  .description("Generate context slice for LLM consumption")
  .option("-r, --route <path>", "Route path to slice (e.g., /dashboard/events)")
  .option("-s, --seeds <files...>", "Seed files for feature slice")
  .option("-n, --name <name>", "Name for feature slice", "feature")
  .option("-d, --depth <n>", "Max import traversal depth", "5")
  .option("-m, --model <model>", "Target LLM model for token budgeting (claude-opus-4.5, gpt-4o, gemini-2.0-pro, etc.)")
  .option("--max-tokens <n>", "Max tokens for slice (overrides model default)")
  .option("--max-bytes <n>", "Max total slice size in bytes", String(8 * 1024 * 1024))
  .option("--max-file-bytes <n>", "Max single file size in bytes", String(400 * 1024))
  .option("-e, --exclude <patterns...>", "Glob patterns to exclude")
  .option("-f, --format <format>", "Output format: json, markdown, or both", "both")
  .option("-o, --output <dir>", "Output directory (default: .repointel/slices)")
  .option("--viz", "Include architecture diagrams in markdown output")
  .action(sliceCommand);

// Aliases for convenience
program
  .command("deps")
  .description("Shortcut for: graph --type deps")
  .option("-s, --seeds <files...>", "Seed files for scoped graph")
  .option("-d, --depth <n>", "Max traversal depth", "10")
  .option("-f, --format <format>", "Output format: json, mermaid, or both", "json")
  .option("-o, --output <dir>", "Output directory")
  .action((opts) => graphCommand({ ...opts, type: "deps" }));

program
  .command("routes")
  .description("Shortcut for: graph --type routes")
  .option("-f, --format <format>", "Output format: json, mermaid, or both", "json")
  .option("-o, --output <dir>", "Output directory")
  .action((opts) => graphCommand({ ...opts, type: "routes" }));

program
  .command("api")
  .description("Shortcut for: graph --type api (Convex functions, REST routes)")
  .option("-f, --format <format>", "Output format: json, mermaid, or both", "json")
  .option("-o, --output <dir>", "Output directory")
  .action((opts) => graphCommand({ ...opts, type: "api" }));

// repointel viz / repointel visualize
program
  .command("viz")
  .alias("visualize")
  .description("Generate rich visualizations (client-server flows, architecture diagrams)")
  .option("-r, --route <path>", "Route path to visualize (e.g., /dashboard/events)")
  .option("-s, --seeds <files...>", "Seed files for feature visualization")
  .option("-n, --name <name>", "Name for feature visualization", "feature")
  .option("-d, --depth <n>", "Max import traversal depth", "5")
  .option("--diagram <type>", "Diagram type: all, dataflow, architecture, sequence, components", "all")
  .option("--direction <dir>", "Graph direction: TD (top-down) or LR (left-right)", "TD")
  .option("-o, --output <dir>", "Output directory (default: .repointel/diagrams)")
  .action(visualizeCommand);

// ============================================================================
// OODA Loop - Primary Workflow
// ============================================================================

// repointel ooda - Main entry point for OODA workflow
program
  .command("ooda")
  .description("OODA loop - Observe, Orient, Decide, Act workflow")
  .option("-r, --refresh", "Force re-scan and re-orient")
  .option("-f, --focus <id>", "Focus on a specific feature (by number, ID, or name)")
  .option("-o, --output <dir>", "Output directory for decision context")
  .action(oodaCommand);

// ============================================================================
// SpecKit Integration
// ============================================================================

// repointel specify
program
  .command("specify")
  .description("SpecKit compatibility - manage .specify/ specs, plans, and tasks")
  .option("--init", "Initialize .specify/ folder structure")
  .option("--name <name>", "Project name for constitution (used with --init)")
  .option("--purpose <text>", "Project purpose/description for constitution (used with --init)")
  .option("--list", "List all features in .specify/specs/")
  .option("--create <name>", "Create a new feature specification")
  .option("--focus <id>", "Focus on a feature (by number, ID, or name)")
  .option("-r, --route <path>", "Route path to include in feature context")
  .option("-s, --seeds <files...>", "Seed files to include in feature context")
  .option("-d, --depth <n>", "Max import traversal depth", "5")
  .action(specifyCommand);

// ============================================================================
// Spec/Audit/Heal Workflow
// ============================================================================

// repointel spec
program
  .command("spec")
  .description("Generate LLM prompt to create a route specification")
  .requiredOption("-r, --route <path>", "Route path (e.g., /dashboard/events)")
  .option("-d, --depth <n>", "Max import traversal depth", "3")
  .option("-o, --output <dir>", "Output directory (default: .repointel/prompts)")
  .option("--refresh", "Force regeneration of index")
  .action(specCommand);

// repointel audit
program
  .command("audit")
  .description("Generate LLM prompt to audit implementation against spec")
  .requiredOption("-r, --route <path>", "Route path (e.g., /dashboard/events)")
  .requiredOption("-s, --spec <file>", "Path to the SPEC.md file")
  .option("-d, --depth <n>", "Max import traversal depth", "3")
  .option("-o, --output <dir>", "Output directory (default: .repointel/prompts)")
  .option("--refresh", "Force regeneration of index")
  .action(auditCommand);

// repointel heal
program
  .command("heal")
  .description("Generate LLM prompt to fix drift between spec and implementation")
  .requiredOption("-r, --route <path>", "Route path (e.g., /dashboard/events)")
  .requiredOption("-s, --spec <file>", "Path to the SPEC.md file")
  .requiredOption("--drift <file>", "Path to the DRIFT_REPORT.md file")
  .option("-d, --depth <n>", "Max import traversal depth", "3")
  .option("-o, --output <dir>", "Output directory (default: .repointel/prompts)")
  .option("--refresh", "Force regeneration of index")
  .action(healCommand);

program.parse();
