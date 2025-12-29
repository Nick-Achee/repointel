import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  detectSpecKit,
  initializeSpecKit,
  createFeature,
  isSpecKitProject,
  formatFeatureNumber,
  type SpecKitFeature,
  type SpecKitProject,
} from "../core/speckit.js";
import { sliceFeature, sliceRoute } from "../core/slicer.js";
import { buildDepGraphFromSeeds } from "../core/dep-graph.js";
import { buildApiGraph } from "../core/api-graph.js";
import { getIndex } from "../core/indexer.js";
import { readFileSafe } from "../core/utils.js";

export interface SpecifyCommandOptions {
  init?: boolean;
  name?: string;
  purpose?: string;
  list?: boolean;
  create?: string;
  focus?: string;
  route?: string;
  seeds?: string[];
  depth?: string;
}

export async function specifyCommand(options: SpecifyCommandOptions): Promise<void> {
  const root = process.cwd();

  // Auto-initialize if no .specify/ exists and we're doing something that needs it
  if (!isSpecKitProject(root) && (options.create || options.focus)) {
    console.log(pc.dim("\n  No .specify/ found, initializing..."));
    await initializeSpecKit(root);
    console.log(pc.green("  ✓ Created .specify/ structure\n"));
  }

  // Initialize .specify/ structure
  if (options.init) {
    console.log(pc.cyan("\n📋 Initializing SpecKit structure...\n"));

    if (isSpecKitProject(root)) {
      console.log(pc.yellow("  .specify/ already exists"));
    } else {
      await initializeSpecKit(root, {
        name: options.name,
        purpose: options.purpose,
      });
      console.log(pc.green("  Created .specify/ folder structure"));
    }

    console.log("");
    console.log(pc.dim("  Created:"));
    console.log(pc.dim("    .specify/memory/constitution.md"));
    console.log(pc.dim("    .specify/templates/spec-template.md"));
    console.log(pc.dim("    .specify/templates/plan-template.md"));
    console.log(pc.dim("    .specify/templates/tasks-template.md"));
    console.log(pc.dim("    .specify/specs/"));
    console.log(pc.dim("    .specify/scripts/"));
    console.log("");
    if (options.name || options.purpose) {
      console.log(pc.green("✅ SpecKit structure initialized with project context"));
    } else {
      console.log(pc.green("✅ SpecKit structure initialized"));
      console.log(pc.dim("  Tip: Use --name and --purpose for a richer constitution"));
    }
    console.log("");
    return;
  }

  // Focus on a specific feature - show context and next steps
  if (options.focus) {
    await focusOnFeature(root, options.focus, options);
    return;
  }

  // List existing features
  if (options.list) {
    await listFeatures(root);
    return;
  }

  // Create new feature
  if (options.create) {
    await createNewFeature(root, options.create, options);
    return;
  }

  // Default: show smart status with next steps
  await showStatus(root);
}

/**
 * Focus on a specific feature - provide context and guidance
 */
async function focusOnFeature(
  root: string,
  featureId: string,
  options: SpecifyCommandOptions
): Promise<void> {
  const project = await detectSpecKit(root);

  if (!project) {
    console.log(pc.red("\n  No SpecKit project found\n"));
    return;
  }

  // Find the feature (by number or name)
  const feature = findFeature(project, featureId);

  if (!feature) {
    console.log(pc.red(`\n  Feature not found: ${featureId}`));
    console.log(pc.dim("  Available features:"));
    for (const f of project.features) {
      console.log(pc.dim(`    ${formatFeatureNumber(f.number)} - ${f.name}`));
    }
    console.log("");
    return;
  }

  console.log(pc.cyan(`\n📋 Focus: ${feature.id}\n`));
  console.log(pc.cyan("━".repeat(60)));

  // Show spec summary
  if (feature.spec) {
    console.log(pc.bold("\n  📄 Specification"));
    console.log(`    ${pc.dim("Title:")} ${feature.spec.title}`);
    if (feature.spec.description) {
      const desc = feature.spec.description.slice(0, 100);
      console.log(`    ${pc.dim("Desc:")}  ${desc}${feature.spec.description.length > 100 ? "..." : ""}`);
    }
    console.log(`    ${pc.dim("Stories:")}    ${feature.spec.userStories.length}`);
    console.log(`    ${pc.dim("Requirements:")} ${feature.spec.requirements.length}`);
    console.log(`    ${pc.dim("Acceptance:")}  ${feature.spec.acceptance.length}`);
  } else {
    console.log(pc.yellow("\n  📄 No spec.md found"));
    console.log(pc.dim("    → Create one at: .specify/specs/" + feature.id + "/spec.md"));
  }

  // Show plan summary
  if (feature.plan) {
    console.log(pc.bold("\n  📐 Technical Plan"));
    console.log(`    ${pc.dim("Title:")} ${feature.plan.title}`);
    console.log(`    ${pc.dim("Components:")} ${feature.plan.components.length}`);
    if (feature.plan.architecture) {
      console.log(`    ${pc.dim("Architecture:")} Defined`);
    }
  } else {
    console.log(pc.yellow("\n  📐 No plan.md found"));
    console.log(pc.dim("    → Create one at: .specify/specs/" + feature.id + "/plan.md"));
  }

  // Show task progress
  if (feature.tasks && feature.tasks.length > 0) {
    const completed = feature.tasks.filter((t) => t.status === "completed").length;
    const inProgress = feature.tasks.filter((t) => t.status === "in-progress").length;
    const pending = feature.tasks.filter((t) => t.status === "pending").length;

    console.log(pc.bold("\n  ✅ Tasks"));
    console.log(`    ${pc.green("Completed:")}   ${completed}`);
    console.log(`    ${pc.yellow("In Progress:")} ${inProgress}`);
    console.log(`    ${pc.dim("Pending:")}     ${pending}`);

    // Show next pending tasks
    const nextTasks = feature.tasks.filter((t) => t.status === "pending").slice(0, 3);
    if (nextTasks.length > 0) {
      console.log("");
      console.log(pc.dim("    Next up:"));
      for (const task of nextTasks) {
        console.log(`      ${pc.dim("○")} ${task.title}`);
      }
    }

    // Show in-progress tasks
    const activeTasks = feature.tasks.filter((t) => t.status === "in-progress");
    if (activeTasks.length > 0) {
      console.log("");
      console.log(pc.yellow("    Currently working on:"));
      for (const task of activeTasks) {
        console.log(`      ${pc.yellow("●")} ${task.title}`);
      }
    }
  } else {
    console.log(pc.yellow("\n  ✅ No tasks defined"));
    console.log(pc.dim("    → Create tasks at: .specify/specs/" + feature.id + "/tasks.md"));
  }

  // Find related code files
  console.log(pc.bold("\n  🔗 Related Code"));
  const relatedFiles = await findRelatedFiles(root, feature);
  if (relatedFiles.length > 0) {
    for (const file of relatedFiles.slice(0, 8)) {
      console.log(`    ${pc.dim("→")} ${file}`);
    }
    if (relatedFiles.length > 8) {
      console.log(`    ${pc.dim(`... and ${relatedFiles.length - 8} more`)}`);
    }
  } else {
    console.log(pc.dim("    No related files detected"));
    console.log(pc.dim("    → Add seed files to spec.md or plan.md to link code"));
  }

  // Check for cross-references with other specs
  const crossRefs = findCrossReferences(project, feature);
  if (crossRefs.length > 0) {
    console.log(pc.bold("\n  🔀 Cross-References"));
    for (const ref of crossRefs) {
      console.log(`    ${pc.cyan("↔")} ${ref.id}: ${ref.reason}`);
    }
  }

  // Smart next steps based on current state
  console.log("\n" + pc.cyan("━".repeat(60)));
  console.log(pc.bold("\n  💡 Suggested Next Steps\n"));

  const nextSteps = suggestNextSteps(feature);
  for (let i = 0; i < nextSteps.length; i++) {
    console.log(`    ${i + 1}. ${nextSteps[i]}`);
  }

  console.log("\n" + pc.cyan("━".repeat(60)));

  // Show useful commands
  console.log(pc.dim("\n  Commands:"));
  console.log(pc.dim(`    repointel slice --seeds <file> --viz   Get context slice with diagrams`));
  console.log(pc.dim(`    repointel viz --seeds <file>           Generate architecture diagrams`));
  console.log(pc.dim(`    repointel specify --list               See all features`));
  console.log("");
}

/**
 * Find feature by ID, number, or partial name
 */
function findFeature(project: SpecKitProject, query: string): SpecKitFeature | undefined {
  const q = query.toLowerCase();

  // Try exact ID match
  let feature = project.features.find((f) => f.id === query);
  if (feature) return feature;

  // Try number match
  const num = parseInt(query, 10);
  if (!isNaN(num)) {
    feature = project.features.find((f) => f.number === num);
    if (feature) return feature;
  }

  // Try partial name match
  feature = project.features.find((f) => f.name.toLowerCase().includes(q));
  if (feature) return feature;

  // Try ID contains
  feature = project.features.find((f) => f.id.toLowerCase().includes(q));
  return feature;
}

/**
 * Find code files related to a feature
 */
async function findRelatedFiles(root: string, feature: SpecKitFeature): Promise<string[]> {
  const related: string[] = [];

  // Get keywords from spec
  const keywords: string[] = [];
  if (feature.spec) {
    // Extract likely file/component names from spec
    const content = feature.spec.rawContent.toLowerCase();
    const nameMatch = feature.name.toLowerCase().split(/\s+/);
    keywords.push(...nameMatch);

    // Look for backtick code references
    const codeRefs = feature.spec.rawContent.match(/`([^`]+)`/g);
    if (codeRefs) {
      for (const ref of codeRefs) {
        const clean = ref.replace(/`/g, "");
        if (clean.includes("/") || clean.includes(".")) {
          keywords.push(clean);
        }
      }
    }
  }

  // Get index and search for related files
  try {
    const index = await getIndex({ root });

    for (const file of index.files) {
      const fileLower = file.relativePath.toLowerCase();

      // Check if file matches any keyword
      for (const keyword of keywords) {
        if (keyword.length > 3 && fileLower.includes(keyword)) {
          related.push(file.relativePath);
          break;
        }
      }

      // Also check file content for feature name references
      if (!related.includes(file.relativePath)) {
        const content = readFileSafe(file.path);
        if (content) {
          const nameParts = feature.name.toLowerCase().split(/\s+/);
          for (const part of nameParts) {
            if (part.length > 3 && content.toLowerCase().includes(part)) {
              related.push(file.relativePath);
              break;
            }
          }
        }
      }
    }
  } catch {
    // Index not available
  }

  return [...new Set(related)];
}

/**
 * Find cross-references between specs
 */
function findCrossReferences(
  project: SpecKitProject,
  feature: SpecKitFeature
): Array<{ id: string; reason: string }> {
  const refs: Array<{ id: string; reason: string }> = [];

  const featureContent = [
    feature.spec?.rawContent || "",
    feature.plan?.rawContent || "",
  ].join("\n").toLowerCase();

  for (const other of project.features) {
    if (other.id === feature.id) continue;

    // Check if this feature mentions the other
    const otherName = other.name.toLowerCase();
    const otherParts = otherName.split(/\s+/);

    for (const part of otherParts) {
      if (part.length > 3 && featureContent.includes(part)) {
        refs.push({
          id: other.id,
          reason: `References "${part}"`,
        });
        break;
      }
    }

    // Check for shared components mentioned in plans
    if (feature.plan && other.plan) {
      const sharedComponents = feature.plan.components.filter((c) =>
        other.plan!.components.some((oc) => oc.toLowerCase().includes(c.toLowerCase()))
      );
      if (sharedComponents.length > 0) {
        refs.push({
          id: other.id,
          reason: `Shares components: ${sharedComponents.slice(0, 2).join(", ")}`,
        });
      }
    }
  }

  return refs;
}

/**
 * Suggest next steps based on feature state
 */
function suggestNextSteps(feature: SpecKitFeature): string[] {
  const steps: string[] = [];

  // Check spec
  if (!feature.spec || feature.spec.userStories.length === 0) {
    steps.push("Add user stories to spec.md (As a X, I want Y, so that Z)");
  } else if (feature.spec.requirements.length === 0) {
    steps.push("Define requirements in spec.md");
  } else if (feature.spec.acceptance.length === 0) {
    steps.push("Add acceptance criteria to spec.md");
  }

  // Check plan
  if (!feature.plan) {
    steps.push("Create technical plan in plan.md");
  } else if (feature.plan.components.length === 0) {
    steps.push("List components to build/modify in plan.md");
  }

  // Check tasks
  if (!feature.tasks || feature.tasks.length === 0) {
    steps.push("Break down work into tasks in tasks.md");
  } else {
    const pending = feature.tasks.filter((t) => t.status === "pending");
    const inProgress = feature.tasks.filter((t) => t.status === "in-progress");

    if (inProgress.length > 0) {
      steps.push(`Complete in-progress task: "${inProgress[0].title}"`);
    } else if (pending.length > 0) {
      steps.push(`Start next task: "${pending[0].title}"`);
    } else {
      steps.push("All tasks complete! Review and close this feature.");
    }
  }

  // Check for extra files
  if (!feature.hasDataModel && feature.plan?.rawContent.includes("data")) {
    steps.push("Consider adding data-model.md for schema/types");
  }

  if (!feature.hasResearch) {
    steps.push("Add research.md for tech stack decisions");
  }

  return steps.slice(0, 5); // Max 5 steps
}

/**
 * List all features with status
 */
async function listFeatures(root: string): Promise<void> {
  console.log(pc.cyan("\n📋 SpecKit Features\n"));

  const project = await detectSpecKit(root);

  if (!project) {
    console.log(pc.yellow("  No .specify/ folder found"));
    console.log(pc.dim("  Run: repointel specify --init"));
    console.log("");
    return;
  }

  if (project.features.length === 0) {
    console.log(pc.dim("  No features found"));
    console.log(pc.dim("  Run: repointel specify --create \"Feature Name\""));
  } else {
    console.log(pc.bold(`  Found ${project.features.length} feature(s):\n`));

    for (const feature of project.features) {
      const hasSpec = feature.spec ? pc.green("✓") : pc.dim("○");
      const hasPlan = feature.plan ? pc.green("✓") : pc.dim("○");
      const hasTasks = feature.tasks?.length ? pc.green("✓") : pc.dim("○");

      const taskStats = feature.tasks
        ? `${feature.tasks.filter((t) => t.status === "completed").length}/${feature.tasks.length}`
        : "0/0";

      console.log(`  ${pc.cyan(formatFeatureNumber(feature.number))} ${feature.name}`);
      console.log(`      ${hasSpec} spec  ${hasPlan} plan  ${hasTasks} tasks (${taskStats})`);
      console.log("");
    }
  }

  if (project.constitution) {
    console.log(pc.dim("  Constitution: .specify/memory/constitution.md"));
  }

  console.log("");
}

/**
 * Create a new feature
 */
async function createNewFeature(
  root: string,
  featureName: string,
  options: SpecifyCommandOptions
): Promise<void> {
  console.log(pc.cyan(`\n📋 Creating feature: ${featureName}\n`));

  // Build context from route or seeds if provided
  let slice;
  let depGraph;
  let apiGraph;

  if (options.route || options.seeds?.length) {
    console.log(pc.dim("  Building context slice..."));

    const sliceOptions = {
      root,
      depth: options.depth ? parseInt(options.depth, 10) : 5,
    };

    if (options.route) {
      slice = await sliceRoute(options.route, sliceOptions);
    } else if (options.seeds) {
      slice = await sliceFeature(options.seeds, featureName, sliceOptions);
    }

    if (slice) {
      console.log(pc.dim(`  Found ${slice.files.length} relevant files`));

      console.log(pc.dim("  Analyzing dependencies..."));
      depGraph = await buildDepGraphFromSeeds(slice.seedFiles, { root, depth: 10 });

      console.log(pc.dim("  Detecting APIs..."));
      apiGraph = await buildApiGraph({ root });
    }
  }

  // Create the feature
  const feature = await createFeature(root, featureName, {
    slice,
    depGraph,
    apiGraph,
  });

  console.log("");
  console.log(pc.cyan("━".repeat(50)));
  console.log(pc.bold(`📋 FEATURE CREATED: ${feature.id}`));
  console.log(pc.cyan("━".repeat(50)));
  console.log("");
  console.log(`  ${pc.dim("Path:")} ${feature.path}`);
  console.log("");
  console.log(pc.bold("  Files created:"));
  console.log(`    ${pc.dim("→")} spec.md`);
  console.log(`    ${pc.dim("→")} plan.md`);
  console.log(`    ${pc.dim("→")} tasks.md`);

  if (slice) {
    console.log("");
    console.log(pc.bold("  Context included:"));
    console.log(`    ${pc.dim("Files:")}  ${slice.files.length}`);
    console.log(`    ${pc.dim("Tokens:")} ~${slice.summary.totalTokens.toLocaleString()}`);
  }

  console.log("");
  console.log(pc.cyan("━".repeat(50)));
  console.log(pc.green("✅ Feature ready for specification"));
  console.log("");
  console.log(pc.dim("  Next: repointel specify --focus " + feature.number));
  console.log(pc.cyan("━".repeat(50)));
  console.log("");
}

/**
 * Show overall SpecKit status with smart suggestions
 */
async function showStatus(root: string): Promise<void> {
  const project = await detectSpecKit(root);

  if (!project) {
    console.log(pc.cyan("\n📋 SpecKit\n"));
    console.log(pc.dim("  No .specify/ folder found. Would you like to start spec-driven development?\n"));
    console.log(pc.bold("  Quick Start:"));
    console.log(pc.dim("    repointel specify --init                Create .specify/ structure"));
    console.log(pc.dim("    repointel specify --create \"My Feature\" Create your first feature\n"));
    console.log(pc.dim("  SpecKit helps you:"));
    console.log(pc.dim("    • Define requirements before coding"));
    console.log(pc.dim("    • Track features through specs → plans → tasks"));
    console.log(pc.dim("    • Reduce cognitive overhead when switching contexts\n"));
    return;
  }

  console.log(pc.cyan("\n📋 SpecKit Dashboard\n"));
  console.log(pc.cyan("━".repeat(60)));

  // Overview stats
  const totalTasks = project.features.reduce((sum, f) => sum + (f.tasks?.length || 0), 0);
  const completedTasks = project.features.reduce(
    (sum, f) => sum + (f.tasks?.filter((t) => t.status === "completed").length || 0),
    0
  );
  const inProgressTasks = project.features.reduce(
    (sum, f) => sum + (f.tasks?.filter((t) => t.status === "in-progress").length || 0),
    0
  );

  console.log(pc.bold("\n  Overview"));
  console.log(`    ${pc.dim("Features:")}     ${project.features.length}`);
  console.log(`    ${pc.dim("Total Tasks:")}  ${totalTasks}`);
  console.log(`    ${pc.dim("Completed:")}    ${completedTasks} (${totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0}%)`);
  console.log(`    ${pc.dim("In Progress:")} ${inProgressTasks}`);

  // Show features with activity
  if (project.features.length > 0) {
    // Find features with in-progress tasks
    const activeFeatures = project.features.filter(
      (f) => f.tasks?.some((t) => t.status === "in-progress")
    );

    if (activeFeatures.length > 0) {
      console.log(pc.bold("\n  🔥 Active Work"));
      for (const feature of activeFeatures) {
        const activeTasks = feature.tasks!.filter((t) => t.status === "in-progress");
        console.log(`    ${pc.cyan(formatFeatureNumber(feature.number))} ${feature.name}`);
        for (const task of activeTasks) {
          console.log(`       ${pc.yellow("●")} ${task.title}`);
        }
      }
    }

    // Show stalled features (have tasks but none in progress)
    const stalledFeatures = project.features.filter(
      (f) =>
        f.tasks &&
        f.tasks.length > 0 &&
        !f.tasks.some((t) => t.status === "in-progress") &&
        f.tasks.some((t) => t.status === "pending")
    );

    if (stalledFeatures.length > 0) {
      console.log(pc.bold("\n  ⏸️  Ready to Resume"));
      for (const feature of stalledFeatures.slice(0, 3)) {
        const nextTask = feature.tasks!.find((t) => t.status === "pending");
        console.log(`    ${pc.dim(formatFeatureNumber(feature.number))} ${feature.name}`);
        if (nextTask) {
          console.log(`       ${pc.dim("→")} ${nextTask.title}`);
        }
      }
    }

    // Show incomplete specs
    const incompleteSpecs = project.features.filter(
      (f) => !f.spec || f.spec.requirements.length === 0
    );

    if (incompleteSpecs.length > 0) {
      console.log(pc.bold("\n  📝 Needs Specification"));
      for (const feature of incompleteSpecs.slice(0, 3)) {
        console.log(`    ${pc.dim(formatFeatureNumber(feature.number))} ${feature.name}`);
      }
    }
  }

  console.log("\n" + pc.cyan("━".repeat(60)));

  // Commands
  console.log(pc.dim("\n  Commands:"));
  console.log(pc.dim("    repointel specify --list              List all features"));
  console.log(pc.dim("    repointel specify --focus <id>        Focus on a feature"));
  console.log(pc.dim("    repointel specify --create \"Name\"     Create new feature"));
  console.log("");
}
