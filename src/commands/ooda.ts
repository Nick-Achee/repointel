import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import { generateIndex, saveIndex, getIndex } from "../core/indexer.js";
import { buildDepGraph } from "../core/dep-graph.js";
import { buildApiGraph } from "../core/api-graph.js";
import {
  detectSpecKit,
  initializeSpecKit,
  isSpecKitProject,
  formatFeatureNumber,
  type SpecKitProject,
  type SpecKitFeature,
} from "../core/speckit.js";
import { sliceFeature } from "../core/slicer.js";
import { ensureDir, readFileSafe } from "../core/utils.js";
import type { RepoIndex } from "../types/index.js";

export interface OodaCommandOptions {
  refresh?: boolean;
  output?: string;
  focus?: string;
}

interface Constitution {
  name: string;
  description: string;
  purpose: string;
  commands: string[];
  principles: string[];
}

interface OodaState {
  root: string;
  index: RepoIndex | null;
  speckit: SpecKitProject | null;
  currentFeature: SpecKitFeature | null;
  constitution: Constitution | null;
  needsObserve: boolean;
  needsOrient: boolean;
}

/**
 * OODA Loop Entry Point
 *
 * Observe → Orient → Decide → Act
 *
 * This command orchestrates the deterministic OO phases and generates
 * context for the D (Decide) phase, which is handled by your LLM of choice.
 */
export async function oodaCommand(options: OodaCommandOptions): Promise<void> {
  const root = process.cwd();

  console.log(pc.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(pc.bold("  🔄 OODA Loop - Observe → Orient → Decide → Act"));
  console.log(pc.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  // Gather current state
  const state = await gatherState(root, options);

  // Phase 1: OBSERVE (deterministic)
  console.log(pc.bold("  📡 OBSERVE"));
  if (state.needsObserve || options.refresh) {
    console.log(pc.dim("     Scanning repository..."));
    const index = await generateIndex({ root, refresh: true });
    saveIndex(index, path.join(root, ".repointel"));
    state.index = index;
    state.needsObserve = false;
    console.log(pc.green(`     ✓ Indexed ${index.summary.totalFiles} files`));
  } else {
    console.log(pc.green(`     ✓ Index exists (${state.index?.summary.totalFiles} files)`));
  }

  // Phase 2: ORIENT (deterministic)
  console.log(pc.bold("\n  🧭 ORIENT"));

  // Build graphs if needed
  const graphsDir = path.join(root, ".repointel", "graphs");
  const depsPath = path.join(graphsDir, "deps.json");

  if (!fs.existsSync(depsPath) || options.refresh) {
    console.log(pc.dim("     Building dependency graph..."));
    ensureDir(graphsDir);
    const depGraph = await buildDepGraph(root);
    fs.writeFileSync(depsPath, JSON.stringify(depGraph, null, 2));
    console.log(pc.green(`     ✓ ${depGraph.nodes.length} nodes, ${depGraph.edges.length} edges`));
  } else {
    const depGraph = JSON.parse(fs.readFileSync(depsPath, "utf-8"));
    console.log(pc.green(`     ✓ Dependency graph (${depGraph.nodes.length} nodes)`));
  }

  // Detect/initialize SpecKit
  if (!state.speckit && !isSpecKitProject(root)) {
    console.log(pc.dim("     Initializing SpecKit structure..."));
    await initializeSpecKit(root);
    state.speckit = await detectSpecKit(root);
    console.log(pc.green("     ✓ Created .specify/ structure"));
  } else {
    state.speckit = await detectSpecKit(root);
    if (state.speckit) {
      console.log(pc.green(`     ✓ SpecKit (${state.speckit.features.length} features)`));
    }
  }

  // Phase 3: DECIDE (generate context for LLM)
  console.log(pc.bold("\n  🎯 DECIDE"));
  console.log(pc.dim("     Generating decision context for your LLM...\n"));

  const decisionContext = await generateDecisionContext(state, options);

  // Save decision context
  const promptsDir = path.join(root, ".repointel", "prompts");
  ensureDir(promptsDir);
  const contextPath = path.join(promptsDir, "DECISION_CONTEXT.md");
  fs.writeFileSync(contextPath, decisionContext);

  // Show summary
  console.log(pc.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(pc.bold("  📊 CURRENT STATE"));
  console.log(pc.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  printStateSummary(state);

  // Phase 4: DECIDE - Present options for human decision
  console.log(pc.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(pc.bold("  🎯 DECIDE - Choose an action"));
  console.log(pc.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  // Generate available actions based on current state
  const actions = generateActions(state);

  console.log(pc.bold("  Available Actions:\n"));
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const num = pc.cyan(`[${i + 1}]`);
    console.log(`    ${num} ${pc.bold(action.title)}`);
    console.log(`        ${pc.dim(action.description)}`);
    if (action.command) {
      console.log(`        ${pc.dim("→")} ${pc.green(action.command)}`);
    }
    if (action.why) {
      console.log(`        ${pc.dim("Why:")} ${pc.yellow(action.why)}`);
    }
  }

  // Show recommendation
  if (actions.length > 0) {
    console.log(`\n  ${pc.yellow("★")} ${pc.bold("Recommended:")} ${actions[0].title}`);
  }

  console.log(pc.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(pc.bold("  🚀 ACT"));
  console.log(pc.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  console.log(pc.dim("  Tell your LLM which action to take:\n"));
  console.log(`    ${pc.white("\"Do action 1\"")} or ${pc.white("\"Continue with the next task\"")}\n`);

  console.log(pc.dim("  Or feed full context:"));
  console.log(`    ${pc.dim("cat")} ${pc.cyan(".repointel/prompts/DECISION_CONTEXT.md")} ${pc.dim("| claude")}\n`);

  console.log(pc.dim("  Decision context saved to:"));
  console.log(`    ${pc.cyan(contextPath)}\n`);

  console.log(pc.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
}

interface Action {
  title: string;
  description: string;
  command?: string;  // Suggested repointel command
  why?: string;      // Why this action matters
  type: "task" | "spec" | "fix" | "new" | "explore" | "other";
}

function generateActions(state: OodaState): Action[] {
  const actions: Action[] = [];
  const { index, speckit, currentFeature, constitution } = state;

  // Priority 1: Fix anti-patterns (aligns with quality principles)
  if (index) {
    const antiPatternCount = Object.values(index.summary.totalAntiPatterns).reduce((a, b) => a + b, 0);
    if (antiPatternCount > 0) {
      actions.push({
        title: `Fix ${antiPatternCount} anti-pattern(s)`,
        description: "Address code quality issues detected during scan",
        command: "repointel scan --refresh",
        why: "Clean code prevents bugs and improves maintainability",
        type: "fix",
      });
    }
  }

  // Priority 2: Current feature tasks
  if (currentFeature) {
    const inProgress = currentFeature.tasks?.filter(t => t.status === "in_progress") || [];
    const pending = currentFeature.tasks?.filter(t => t.status === "pending") || [];

    if (inProgress.length > 0) {
      const task = inProgress[0];
      actions.push({
        title: `Continue: "${task.title}"`,
        description: `In-progress task for ${currentFeature.name}`,
        command: `repointel slice --seeds ${currentFeature.spec?.entryPoints?.[0] || "src/"} --name ${currentFeature.id}`,
        why: "Complete in-progress work before starting new tasks",
        type: "task",
      });
    } else if (pending.length > 0) {
      const task = pending[0];
      actions.push({
        title: `Start: "${task.title}"`,
        description: `Next pending task for ${currentFeature.name}`,
        command: `repointel slice --seeds ${currentFeature.spec?.entryPoints?.[0] || "src/"} --name ${currentFeature.id}`,
        why: "Focused context helps complete tasks faster",
        type: "task",
      });
    }

    // Check if spec needs work
    if (!currentFeature.spec?.userStories?.length) {
      actions.push({
        title: "Complete specification",
        description: "Add user stories, requirements, acceptance criteria",
        command: `repointel specify --focus ${currentFeature.number}`,
        why: "Clear specs prevent scope creep and misunderstandings",
        type: "spec",
      });
    }
  }

  // Priority 3: Stalled features
  if (speckit) {
    const stalledFeatures = speckit.features.filter(f => {
      const completed = f.tasks?.filter(t => t.status === "completed") || [];
      const total = f.tasks?.length || 0;
      return total > 0 && completed.length > 0 && completed.length < total && f !== currentFeature;
    });

    if (stalledFeatures.length > 0) {
      const stalled = stalledFeatures[0];
      const completed = stalled.tasks?.filter(t => t.status === "completed").length || 0;
      const total = stalled.tasks?.length || 0;
      actions.push({
        title: `Resume: "${stalled.name}"`,
        description: `${completed}/${total} tasks done - pick up where you left off`,
        command: `repointel specify --focus ${stalled.number}`,
        why: "Finishing started work is more valuable than starting new work",
        type: "task",
      });
    }
  }

  // Priority 4: Create new feature
  actions.push({
    title: "Create new feature",
    description: "Start a new specification with code context",
    command: "repointel specify --create \"Feature Name\" --seeds src/",
    why: "Spec-driven development keeps projects organized",
    type: "new",
  });

  // Priority 5: Explore codebase
  actions.push({
    title: "Explore codebase",
    description: "Generate architecture diagrams or focused context",
    command: "repointel viz --seeds src/ --diagram dataflow",
    why: "Understanding structure helps make better decisions",
    type: "explore",
  });

  return actions.slice(0, 5); // Max 5 options
}

async function gatherState(root: string, options: OodaCommandOptions): Promise<OodaState> {
  const indexPath = path.join(root, ".repointel", "index.json");
  const hasIndex = fs.existsSync(indexPath);

  let index: RepoIndex | null = null;
  if (hasIndex) {
    try {
      index = await getIndex(root);
    } catch {
      // Will need to re-observe
    }
  }

  const speckit = await detectSpecKit(root);

  // Read constitution
  let constitution: Constitution | null = null;
  const constitutionPath = path.join(root, ".specify", "memory", "constitution.md");
  const constitutionContent = readFileSafe(constitutionPath);
  if (constitutionContent) {
    constitution = parseConstitution(constitutionContent);
  }

  // Find current/focused feature
  let currentFeature: SpecKitFeature | null = null;
  if (speckit && options.focus) {
    currentFeature = findFeature(speckit, options.focus);
  } else if (speckit && speckit.features.length > 0) {
    // Auto-detect: find in-progress feature
    currentFeature = speckit.features.find(f => {
      const inProgress = f.tasks?.filter(t => t.status === "in_progress") || [];
      return inProgress.length > 0;
    }) || speckit.features[speckit.features.length - 1];
  }

  return {
    root,
    index,
    speckit,
    currentFeature,
    constitution,
    needsObserve: !hasIndex || !index,
    needsOrient: !speckit,
  };
}

/**
 * Parse constitution.md to extract project purpose and principles
 */
function parseConstitution(content: string): Constitution {
  const lines = content.split("\n");

  // Extract name from first heading
  const nameMatch = content.match(/^#\s+(.+)$/m);
  const name = nameMatch?.[1] || "Unknown Project";

  // Extract description from blockquote after heading
  const descMatch = content.match(/^>\s*(.+)$/m);
  const description = descMatch?.[1] || "";

  // Extract purpose from "What This Project Is" or "What It Does" section
  let purpose = "";
  const purposeMatch = content.match(/## What This Project Is\n\n([\s\S]*?)(?=\n## |$)/);
  if (purposeMatch) {
    purpose = purposeMatch[1].trim().split("\n\n")[0];
  }

  // Extract commands from "What It Does" section
  const commands: string[] = [];
  const commandsMatch = content.match(/## What It Does\n\n([\s\S]*?)(?=\n## |$)/);
  if (commandsMatch) {
    const cmdLines = commandsMatch[1].split("\n");
    for (const line of cmdLines) {
      const cmdMatch = line.match(/^-\s*`([^`]+)`\s*[—-]\s*(.+)$/);
      if (cmdMatch) {
        commands.push(`${cmdMatch[1]}: ${cmdMatch[2]}`);
      }
    }
  }

  // Extract principles from "Core Principles" section
  const principles: string[] = [];
  const principlesMatch = content.match(/## Core Principles\n\n([\s\S]*?)(?=\n## |$)/);
  if (principlesMatch) {
    const principleLines = principlesMatch[1].split("\n");
    for (const line of principleLines) {
      const pMatch = line.match(/^\d+\.\s+\*\*([^*]+)\*\*:\s*(.+)$/);
      if (pMatch) {
        principles.push(`${pMatch[1]}: ${pMatch[2]}`);
      }
    }
  }

  return { name, description, purpose, commands, principles };
}

function findFeature(project: SpecKitProject, query: string): SpecKitFeature | undefined {
  const q = query.toLowerCase();

  // Try by number first
  const num = parseInt(q, 10);
  if (!isNaN(num)) {
    return project.features.find(f => f.number === num);
  }

  // Try by ID
  const byId = project.features.find(f => f.id.toLowerCase() === q);
  if (byId) return byId;

  // Try by partial name match
  return project.features.find(f =>
    f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)
  );
}

async function generateDecisionContext(state: OodaState, options: OodaCommandOptions): Promise<string> {
  const { root, index, speckit, currentFeature, constitution } = state;

  let context = `# Decision Context

> Generated by repointel OODA loop
> Feed this to your LLM (Claude Code, Codex, etc.) for the DECIDE phase

`;

  // Add project purpose from constitution
  if (constitution) {
    context += `## Project: ${constitution.name}

${constitution.description ? `> ${constitution.description}\n\n` : ""}`;

    if (constitution.purpose) {
      context += `### What This Project Is

${constitution.purpose}

`;
    }

    if (constitution.commands.length > 0) {
      context += `### Available Commands

${constitution.commands.map(c => `- ${c}`).join("\n")}

`;
    }

    if (constitution.principles.length > 0) {
      context += `### Core Principles

${constitution.principles.map(p => `- ${p}`).join("\n")}

`;
    }
  }

  context += `## Repository Overview

`;

  // Add index summary
  if (index) {
    context += `**Files:** ${index.summary.totalFiles}
**Frameworks:** ${index.frameworks.map(f => f.name).join(", ") || "None detected"}
**Specs:** ${index.specs.map(s => s.type).join(", ") || "None detected"}

### File Types
${Object.entries(index.summary.byType)
  .filter(([, count]) => count > 0)
  .sort(([, a], [, b]) => b - a)
  .map(([type, count]) => `- ${type}: ${count}`)
  .join("\n")}

### Code Quality
- Client components: ${index.summary.clientComponents}
- Server components: ${index.summary.serverComponents}
`;

    // Anti-patterns
    const antiPatterns = Object.entries(index.summary.totalAntiPatterns)
      .filter(([, count]) => count > 0);
    if (antiPatterns.length > 0) {
      context += `
### ⚠️ Anti-Patterns Detected
${antiPatterns.map(([pattern, count]) => `- ${pattern}: ${count}`).join("\n")}
`;
    }
  }

  // Add SpecKit context
  if (speckit) {
    context += `
## SpecKit Status

**Total Features:** ${speckit.features.length}
`;

    // In-progress work
    const inProgressFeatures = speckit.features.filter(f => {
      const inProgress = f.tasks?.filter(t => t.status === "in_progress") || [];
      return inProgress.length > 0;
    });

    if (inProgressFeatures.length > 0) {
      context += `
### 🔄 Currently In Progress
${inProgressFeatures.map(f => {
  const inProgress = f.tasks?.filter(t => t.status === "in_progress") || [];
  return `- **${f.id}**: ${f.name}
  - Active tasks: ${inProgress.map(t => t.title).join(", ")}`;
}).join("\n")}
`;
    }

    // Features needing attention
    const stalledFeatures = speckit.features.filter(f => {
      const completed = f.tasks?.filter(t => t.status === "completed") || [];
      const total = f.tasks?.length || 0;
      return total > 0 && completed.length > 0 && completed.length < total;
    });

    if (stalledFeatures.length > 0) {
      context += `
### ⏸️ Features Ready to Resume
${stalledFeatures.map(f => {
  const completed = f.tasks?.filter(t => t.status === "completed").length || 0;
  const total = f.tasks?.length || 0;
  return `- **${f.id}**: ${f.name} (${completed}/${total} tasks done)`;
}).join("\n")}
`;
    }
  }

  // Current feature focus
  if (currentFeature) {
    context += `
## 🎯 Current Focus: ${currentFeature.name}

**ID:** ${currentFeature.id}
**Path:** ${currentFeature.path}

`;

    // Spec summary
    if (currentFeature.spec) {
      context += `### Specification
${currentFeature.spec.title ? `**Title:** ${currentFeature.spec.title}` : ""}
${currentFeature.spec.description ? `\n${currentFeature.spec.description}` : ""}

**User Stories:** ${currentFeature.spec.userStories?.length || 0}
**Requirements:** ${currentFeature.spec.requirements?.length || 0}
**Acceptance Criteria:** ${currentFeature.spec.acceptance?.length || 0}
`;
    }

    // Plan summary
    if (currentFeature.plan) {
      context += `
### Technical Plan
${currentFeature.plan.title ? `**Title:** ${currentFeature.plan.title}` : ""}
**Components:** ${currentFeature.plan.components?.length || 0}
**Architecture:** ${currentFeature.plan.architecture ? "Defined" : "Not defined"}
`;
    }

    // Tasks
    if (currentFeature.tasks && currentFeature.tasks.length > 0) {
      const completed = currentFeature.tasks.filter(t => t.status === "completed");
      const inProgress = currentFeature.tasks.filter(t => t.status === "in_progress");
      const pending = currentFeature.tasks.filter(t => t.status === "pending");

      context += `
### Tasks
- **Completed:** ${completed.length}
- **In Progress:** ${inProgress.length}
- **Pending:** ${pending.length}

`;

      if (inProgress.length > 0) {
        context += `#### Currently Working On
${inProgress.map(t => `- [ ] ${t.title}`).join("\n")}

`;
      }

      if (pending.length > 0) {
        context += `#### Next Up
${pending.slice(0, 5).map(t => `- [ ] ${t.title}`).join("\n")}
`;
      }
    }

    // Include spec.md content
    const specPath = path.join(currentFeature.path, "spec.md");
    const specContent = readFileSafe(specPath);
    if (specContent) {
      context += `
---

## Full Specification

\`\`\`markdown
${specContent}
\`\`\`
`;
    }

    // Include plan.md content
    const planPath = path.join(currentFeature.path, "plan.md");
    const planContent = readFileSafe(planPath);
    if (planContent) {
      context += `
## Full Technical Plan

\`\`\`markdown
${planContent}
\`\`\`
`;
    }

    // Include tasks.md content
    const tasksPath = path.join(currentFeature.path, "tasks.md");
    const tasksContent = readFileSafe(tasksPath);
    if (tasksContent) {
      context += `
## Full Task List

\`\`\`markdown
${tasksContent}
\`\`\`
`;
    }
  }

  // Add guidance for the LLM
  context += `
---

## Instructions for LLM

You are now in the **DECIDE** phase of the OODA loop. Based on the context above:

1. **Analyze** the current state of the project
2. **Identify** what needs to be done next
3. **Propose** specific actions to take

### If there's a current feature focus:
- Review the spec, plan, and tasks
- Identify the next uncompleted task
- Propose the implementation approach

### If no feature is in progress:
- Review the anti-patterns and suggest fixes
- Propose a new feature to work on
- Or suggest improvements to existing code

### When ready to ACT:
- Use repointel tools to generate context slices: \`repointel slice --seeds <files>\`
- Update task status in .specify/specs/*/tasks.md
- Run \`repointel ooda\` again after completing work to update state

---

*Generated by repointel v0.2.0*
`;

  return context;
}

function printStateSummary(state: OodaState): void {
  const { index, speckit, currentFeature, constitution } = state;

  // Show project name if we have constitution
  if (constitution) {
    console.log(`  ${pc.dim("Project:")}      ${pc.bold(constitution.name)}`);
  }

  if (index) {
    console.log(`  ${pc.dim("Files:")}        ${index.summary.totalFiles}`);
    console.log(`  ${pc.dim("Frameworks:")}   ${index.frameworks.map(f => f.name).join(", ") || "None"}`);

    const antiPatterns = Object.values(index.summary.totalAntiPatterns).reduce((a, b) => a + b, 0);
    if (antiPatterns > 0) {
      console.log(`  ${pc.dim("Anti-patterns:")} ${pc.yellow(String(antiPatterns))}`);
    }
  }

  if (speckit) {
    console.log(`  ${pc.dim("Features:")}     ${speckit.features.length}`);

    const totalTasks = speckit.features.reduce((sum, f) => sum + (f.tasks?.length || 0), 0);
    const completedTasks = speckit.features.reduce((sum, f) =>
      sum + (f.tasks?.filter(t => t.status === "completed").length || 0), 0);

    if (totalTasks > 0) {
      const pct = Math.round((completedTasks / totalTasks) * 100);
      console.log(`  ${pc.dim("Progress:")}     ${completedTasks}/${totalTasks} tasks (${pct}%)`);
    }
  }

  if (currentFeature) {
    console.log(`  ${pc.dim("Focus:")}        ${pc.cyan(currentFeature.name)}`);
  }
}
