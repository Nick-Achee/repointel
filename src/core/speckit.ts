import * as path from "node:path";
import * as fs from "node:fs";
import fg from "fast-glob";
import { readFileSafe, writeJson, ensureDir } from "./utils.js";
import type { ContextSlice, RepoIndex, DepGraph, ApiGraph } from "../types/index.js";

const SPECKIT_VERSION = "1.0.0";

// =============================================================================
// Types
// =============================================================================

export interface SpecKitProject {
  version: string;
  root: string;
  hasSpecify: boolean;
  hasGithubPrompts: boolean;
  constitution?: string;
  features: SpecKitFeature[];
  templates: string[];
  scripts: string[];
}

export interface SpecKitFeature {
  id: string;
  number: number;
  name: string;
  path: string;
  spec?: SpecKitSpec;
  plan?: SpecKitPlan;
  tasks?: SpecKitTask[];
  hasDataModel: boolean;
  hasResearch: boolean;
  hasContracts: boolean;
}

export interface SpecKitSpec {
  title: string;
  description?: string;
  userStories: string[];
  requirements: string[];
  acceptance: string[];
  clarifications: string[];
  rawContent: string;
}

export interface SpecKitPlan {
  title: string;
  architecture?: string;
  components: string[];
  dataFlow?: string;
  rawContent: string;
}

export interface SpecKitTask {
  id: string;
  title: string;
  status: "pending" | "in-progress" | "completed";
  dependencies: string[];
  parallel: boolean;
  description?: string;
}

// =============================================================================
// Detection
// =============================================================================

/**
 * Check if a directory is a SpecKit project
 */
export function isSpecKitProject(root: string): boolean {
  return fs.existsSync(path.join(root, ".specify"));
}

/**
 * Detect SpecKit project structure
 */
export async function detectSpecKit(root: string): Promise<SpecKitProject | null> {
  const specifyPath = path.join(root, ".specify");

  if (!fs.existsSync(specifyPath)) {
    return null;
  }

  const project: SpecKitProject = {
    version: SPECKIT_VERSION,
    root,
    hasSpecify: true,
    hasGithubPrompts: fs.existsSync(path.join(root, ".github", "prompts")),
    features: [],
    templates: [],
    scripts: [],
  };

  // Read constitution
  const constitutionPath = path.join(specifyPath, "memory", "constitution.md");
  if (fs.existsSync(constitutionPath)) {
    project.constitution = readFileSafe(constitutionPath) || undefined;
  }

  // Find templates
  const templatesDir = path.join(specifyPath, "templates");
  if (fs.existsSync(templatesDir)) {
    const templateFiles = await fg("*.md", { cwd: templatesDir });
    project.templates = templateFiles;
  }

  // Find scripts
  const scriptsDir = path.join(specifyPath, "scripts");
  if (fs.existsSync(scriptsDir)) {
    const scriptFiles = await fg("*.sh", { cwd: scriptsDir });
    project.scripts = scriptFiles;
  }

  // Find feature specs
  const specsDir = path.join(specifyPath, "specs");
  if (fs.existsSync(specsDir)) {
    const featureDirs = fs.readdirSync(specsDir).filter((d) => {
      const fullPath = path.join(specsDir, d);
      return fs.statSync(fullPath).isDirectory() && /^\d{3}-/.test(d);
    });

    for (const dir of featureDirs) {
      const feature = await parseFeature(path.join(specsDir, dir), dir);
      if (feature) {
        project.features.push(feature);
      }
    }

    // Sort by feature number
    project.features.sort((a, b) => a.number - b.number);
  }

  return project;
}

/**
 * Parse a feature directory
 */
async function parseFeature(featurePath: string, dirName: string): Promise<SpecKitFeature | null> {
  const match = dirName.match(/^(\d{3})-(.+)$/);
  if (!match) return null;

  const [, numStr, name] = match;
  const number = parseInt(numStr, 10);

  const feature: SpecKitFeature = {
    id: dirName,
    number,
    name: name.replace(/-/g, " "),
    path: featurePath,
    hasDataModel: fs.existsSync(path.join(featurePath, "data-model.md")),
    hasResearch: fs.existsSync(path.join(featurePath, "research.md")),
    hasContracts: fs.existsSync(path.join(featurePath, "contracts")),
  };

  // Parse spec.md
  const specPath = path.join(featurePath, "spec.md");
  if (fs.existsSync(specPath)) {
    feature.spec = parseSpec(readFileSafe(specPath) || "");
  }

  // Parse plan.md
  const planPath = path.join(featurePath, "plan.md");
  if (fs.existsSync(planPath)) {
    feature.plan = parsePlan(readFileSafe(planPath) || "");
  }

  // Parse tasks.md
  const tasksPath = path.join(featurePath, "tasks.md");
  if (fs.existsSync(tasksPath)) {
    feature.tasks = parseTasks(readFileSafe(tasksPath) || "");
  }

  return feature;
}

/**
 * Parse spec.md content
 */
function parseSpec(content: string): SpecKitSpec {
  const lines = content.split("\n");
  const spec: SpecKitSpec = {
    title: "",
    userStories: [],
    requirements: [],
    acceptance: [],
    clarifications: [],
    rawContent: content,
  };

  // Extract title (first # heading)
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    spec.title = titleMatch[1];
  }

  // Extract description (text after title before next heading)
  const descMatch = content.match(/^#\s+.+\n\n([\s\S]+?)(?=\n##|\n#|$)/);
  if (descMatch) {
    spec.description = descMatch[1].trim();
  }

  // Extract user stories
  const userStoriesMatch = content.match(/##\s*User Stories?\s*\n([\s\S]+?)(?=\n##|$)/i);
  if (userStoriesMatch) {
    spec.userStories = extractBulletPoints(userStoriesMatch[1]);
  }

  // Extract requirements
  const requirementsMatch = content.match(/##\s*(?:Functional\s+)?Requirements?\s*\n([\s\S]+?)(?=\n##|$)/i);
  if (requirementsMatch) {
    spec.requirements = extractBulletPoints(requirementsMatch[1]);
  }

  // Extract acceptance criteria
  const acceptanceMatch = content.match(/##\s*(?:Review\s*&?\s*)?Acceptance\s*(?:Criteria|Checklist)?\s*\n([\s\S]+?)(?=\n##|$)/i);
  if (acceptanceMatch) {
    spec.acceptance = extractBulletPoints(acceptanceMatch[1]);
  }

  // Extract clarifications
  const clarificationsMatch = content.match(/##\s*Clarifications?\s*\n([\s\S]+?)(?=\n##|$)/i);
  if (clarificationsMatch) {
    spec.clarifications = extractBulletPoints(clarificationsMatch[1]);
  }

  return spec;
}

/**
 * Parse plan.md content
 */
function parsePlan(content: string): SpecKitPlan {
  const plan: SpecKitPlan = {
    title: "",
    components: [],
    rawContent: content,
  };

  // Extract title
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    plan.title = titleMatch[1];
  }

  // Extract architecture section
  const archMatch = content.match(/##\s*Architecture\s*\n([\s\S]+?)(?=\n##|$)/i);
  if (archMatch) {
    plan.architecture = archMatch[1].trim();
  }

  // Extract components
  const componentsMatch = content.match(/##\s*Components?\s*\n([\s\S]+?)(?=\n##|$)/i);
  if (componentsMatch) {
    plan.components = extractBulletPoints(componentsMatch[1]);
  }

  // Extract data flow
  const dataFlowMatch = content.match(/##\s*Data\s*Flow\s*\n([\s\S]+?)(?=\n##|$)/i);
  if (dataFlowMatch) {
    plan.dataFlow = dataFlowMatch[1].trim();
  }

  return plan;
}

/**
 * Parse tasks.md content
 */
function parseTasks(content: string): SpecKitTask[] {
  const tasks: SpecKitTask[] = [];
  const lines = content.split("\n");

  let currentTask: Partial<SpecKitTask> | null = null;

  for (const line of lines) {
    // Task line: - [ ] Task title or - [x] Completed task
    const taskMatch = line.match(/^-\s*\[([ xX])\]\s*(.+)$/);
    if (taskMatch) {
      if (currentTask && currentTask.title) {
        tasks.push(currentTask as SpecKitTask);
      }

      const isCompleted = taskMatch[1].toLowerCase() === "x";
      const title = taskMatch[2].trim();

      currentTask = {
        id: `task-${tasks.length + 1}`,
        title,
        status: isCompleted ? "completed" : "pending",
        dependencies: [],
        parallel: title.includes("||") || title.includes("[parallel]"),
      };

      // Extract dependencies from title: (depends: task-1, task-2)
      const depsMatch = title.match(/\(depends?:\s*([^)]+)\)/i);
      if (depsMatch) {
        currentTask.dependencies = depsMatch[1].split(",").map((d) => d.trim());
        currentTask.title = title.replace(/\(depends?:[^)]+\)/i, "").trim();
      }

      continue;
    }

    // Description line (indented under task)
    if (currentTask && line.match(/^\s{2,}/)) {
      currentTask.description = (currentTask.description || "") + line.trim() + "\n";
    }
  }

  if (currentTask && currentTask.title) {
    tasks.push(currentTask as SpecKitTask);
  }

  return tasks;
}

/**
 * Extract bullet points from markdown section
 * Supports: - bullets, * bullets, and 1. numbered lists
 */
function extractBulletPoints(content: string): string[] {
  const lines = content.split("\n");
  const points: string[] = [];

  for (const line of lines) {
    // Match: - item, * item, or 1. item (numbered lists)
    const match = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (match) {
      points.push(match[1].trim());
    }
  }

  return points;
}

// =============================================================================
// Integration with RepoIntel
// =============================================================================

/**
 * Generate a context slice enhanced with SpecKit info
 */
export function enhanceSliceWithSpec(
  slice: ContextSlice,
  feature: SpecKitFeature
): ContextSlice & { speckit: SpecKitFeature } {
  return {
    ...slice,
    speckit: feature,
  };
}

/**
 * Get next feature number for a SpecKit project
 */
export function getNextFeatureNumber(project: SpecKitProject): number {
  if (project.features.length === 0) {
    return 1;
  }
  return Math.max(...project.features.map((f) => f.number)) + 1;
}

/**
 * Format feature number as 3-digit string
 */
export function formatFeatureNumber(num: number): string {
  return num.toString().padStart(3, "0");
}

// =============================================================================
// SpecKit Output Generation
// =============================================================================

/**
 * Generate a SpecKit-compatible spec.md from a context slice
 */
export function generateSpecFromSlice(
  slice: ContextSlice,
  featureName: string,
  options: {
    apiGraph?: ApiGraph;
    depGraph?: DepGraph;
  } = {}
): string {
  const lines: string[] = [];

  lines.push(`# ${featureName}`);
  lines.push("");
  lines.push(`> Auto-generated specification from RepoIntel context slice`);
  lines.push("");

  // Overview
  lines.push("## Overview");
  lines.push("");
  lines.push(`This specification covers the \`${slice.name}\` ${slice.type}.`);
  lines.push("");

  // Files included
  lines.push("## Scope");
  lines.push("");
  lines.push(`**Files:** ${slice.summary.totalFiles}`);
  lines.push(`**Size:** ${Math.round(slice.summary.totalBytes / 1024)} KB`);
  lines.push(`**Tokens:** ~${slice.summary.totalTokens.toLocaleString()}`);
  lines.push("");

  // File types breakdown
  lines.push("### File Types");
  lines.push("");
  for (const [type, count] of Object.entries(slice.summary.byType)) {
    if (count > 0) {
      lines.push(`- **${type}**: ${count}`);
    }
  }
  lines.push("");

  // Seed files as entry points
  lines.push("## Entry Points");
  lines.push("");
  for (const seed of slice.seedFiles) {
    lines.push(`- \`${seed}\``);
  }
  lines.push("");

  // API endpoints if available
  if (options.apiGraph && options.apiGraph.endpoints.length > 0) {
    lines.push("## API Endpoints");
    lines.push("");
    for (const endpoint of options.apiGraph.endpoints) {
      const auth = endpoint.isPublic ? "public" : "protected";
      lines.push(`- \`${endpoint.name}\` (${endpoint.type}, ${auth})`);
    }
    lines.push("");
  }

  // Placeholder sections for SpecKit workflow
  lines.push("## User Stories");
  lines.push("");
  lines.push("<!-- Add user stories here -->");
  lines.push("");

  lines.push("## Requirements");
  lines.push("");
  lines.push("<!-- Add functional requirements here -->");
  lines.push("");

  lines.push("## Acceptance Criteria");
  lines.push("");
  lines.push("<!-- Add acceptance criteria here -->");
  lines.push("");

  lines.push("## Clarifications");
  lines.push("");
  lines.push("<!-- Use /speckit.clarify to populate -->");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate a SpecKit-compatible plan.md from analysis
 */
export function generatePlanFromAnalysis(
  slice: ContextSlice,
  featureName: string,
  options: {
    depGraph?: DepGraph;
    apiGraph?: ApiGraph;
    visualization?: string;
  } = {}
): string {
  const lines: string[] = [];

  lines.push(`# Technical Plan: ${featureName}`);
  lines.push("");
  lines.push(`> Auto-generated plan from RepoIntel analysis`);
  lines.push("");

  // Architecture overview
  lines.push("## Architecture");
  lines.push("");
  lines.push(`This ${slice.type} involves ${slice.summary.totalFiles} files across ${slice.summary.maxDepth + 1} dependency levels.`);
  lines.push("");

  // Components by type
  lines.push("## Components");
  lines.push("");
  const filesByType = new Map<string, string[]>();
  for (const file of slice.files) {
    const list = filesByType.get(file.type) || [];
    list.push(file.relativePath);
    filesByType.set(file.type, list);
  }

  for (const [type, files] of filesByType) {
    lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}`);
    lines.push("");
    for (const file of files.slice(0, 10)) {
      lines.push(`- \`${file}\``);
    }
    if (files.length > 10) {
      lines.push(`- ... and ${files.length - 10} more`);
    }
    lines.push("");
  }

  // Data flow diagram if visualization provided
  if (options.visualization) {
    lines.push("## Data Flow");
    lines.push("");
    lines.push("```mermaid");
    lines.push(options.visualization);
    lines.push("```");
    lines.push("");
  }

  // Dependencies
  if (options.depGraph) {
    lines.push("## Dependencies");
    lines.push("");
    lines.push(`- **Internal:** ${options.depGraph.stats.totalEdges} imports`);
    lines.push(`- **External:** ${options.depGraph.stats.externalDeps} packages`);
    if (options.depGraph.stats.circularDeps > 0) {
      lines.push(`- **Circular:** ${options.depGraph.stats.circularDeps} (requires attention)`);
    }
    lines.push("");
  }

  // Implementation notes
  lines.push("## Implementation Notes");
  lines.push("");
  lines.push("<!-- Add implementation details here -->");
  lines.push("");

  return lines.join("\n");
}

export interface InitializeSpecKitOptions {
  name?: string;
  purpose?: string;
}

/**
 * Initialize .specify/ folder structure
 */
export async function initializeSpecKit(
  root: string,
  options: InitializeSpecKitOptions = {}
): Promise<void> {
  const specifyPath = path.join(root, ".specify");

  // Create directory structure
  ensureDir(path.join(specifyPath, "memory"));
  ensureDir(path.join(specifyPath, "scripts"));
  ensureDir(path.join(specifyPath, "specs"));
  ensureDir(path.join(specifyPath, "templates"));

  // Infer project name from directory if not provided
  const projectName = options.name || path.basename(root);

  // Create constitution.md if it doesn't exist
  const constitutionPath = path.join(specifyPath, "memory", "constitution.md");
  if (!fs.existsSync(constitutionPath)) {
    let constitution: string;

    if (options.purpose) {
      // Rich constitution with project context
      constitution = `# ${projectName}

> ${options.purpose}

## What This Project Is

${options.purpose}

## What It Does

<!-- Document your CLI commands, API endpoints, or key features here -->

## Core Principles

1. **Specification First**: Define requirements before implementation
2. **Clarity**: Specifications should be unambiguous and testable
3. **Traceability**: Changes should be traceable to specifications

## Development Guidelines

- Follow existing code patterns and conventions
- Write tests for new functionality
- Document public APIs

## Quality Standards

- All code must pass linting and type checks
- Test coverage should not decrease
- Performance regressions are not acceptable

---
*This is ${projectName}'s constitution, generated by RepoIntel.*
`;
    } else {
      // Default constitution
      constitution = `# ${projectName}

## Core Principles

1. **Specification First**: Define requirements before implementation
2. **Clarity**: Specifications should be unambiguous and testable
3. **Traceability**: Changes should be traceable to specifications

## Development Guidelines

- Follow existing code patterns and conventions
- Write tests for new functionality
- Document public APIs

## Quality Standards

- All code must pass linting and type checks
- Test coverage should not decrease
- Performance regressions are not acceptable

---
*Generated by RepoIntel with SpecKit compatibility*
`;
    }
    fs.writeFileSync(constitutionPath, constitution);
  }

  // Create spec template
  const specTemplatePath = path.join(specifyPath, "templates", "spec-template.md");
  if (!fs.existsSync(specTemplatePath)) {
    const specTemplate = `# [Feature Name]

## Overview

[Brief description of the feature]

## User Stories

- As a [user type], I want to [action] so that [benefit]

## Requirements

- [ ] Requirement 1
- [ ] Requirement 2

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Clarifications

<!-- Questions and answers from clarification process -->
`;
    fs.writeFileSync(specTemplatePath, specTemplate);
  }

  // Create plan template
  const planTemplatePath = path.join(specifyPath, "templates", "plan-template.md");
  if (!fs.existsSync(planTemplatePath)) {
    const planTemplate = `# Technical Plan: [Feature Name]

## Architecture

[High-level architecture description]

## Components

### New Components

- Component 1: [description]

### Modified Components

- Component 1: [changes needed]

## Data Flow

[Description or diagram of data flow]

## Implementation Notes

[Technical considerations and decisions]
`;
    fs.writeFileSync(planTemplatePath, planTemplate);
  }

  // Create tasks template
  const tasksTemplatePath = path.join(specifyPath, "templates", "tasks-template.md");
  if (!fs.existsSync(tasksTemplatePath)) {
    const tasksTemplate = `# Tasks: [Feature Name]

## Setup

- [ ] Create feature branch
- [ ] Set up development environment

## Implementation

- [ ] Task 1
- [ ] Task 2 (depends: Task 1)
- [ ] Task 3 || Task 4 [parallel]

## Testing

- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Manual QA

## Completion

- [ ] Code review
- [ ] Documentation
- [ ] Merge to main
`;
    fs.writeFileSync(tasksTemplatePath, tasksTemplate);
  }
}

/**
 * Create a new feature in .specify/specs/
 */
export async function createFeature(
  root: string,
  name: string,
  options: {
    slice?: ContextSlice;
    apiGraph?: ApiGraph;
    depGraph?: DepGraph;
  } = {}
): Promise<SpecKitFeature> {
  const project = await detectSpecKit(root);
  const featureNumber = project ? getNextFeatureNumber(project) : 1;
  const featureId = `${formatFeatureNumber(featureNumber)}-${name.toLowerCase().replace(/\s+/g, "-")}`;

  const featurePath = path.join(root, ".specify", "specs", featureId);
  ensureDir(featurePath);

  // Generate spec.md
  if (options.slice) {
    const specContent = generateSpecFromSlice(options.slice, name, {
      apiGraph: options.apiGraph,
    });
    fs.writeFileSync(path.join(featurePath, "spec.md"), specContent);

    // Generate plan.md
    const planContent = generatePlanFromAnalysis(options.slice, name, {
      depGraph: options.depGraph,
      apiGraph: options.apiGraph,
    });
    fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);
  } else {
    // Use templates
    const specTemplate = readFileSafe(path.join(root, ".specify", "templates", "spec-template.md"));
    const planTemplate = readFileSafe(path.join(root, ".specify", "templates", "plan-template.md"));

    if (specTemplate) {
      fs.writeFileSync(
        path.join(featurePath, "spec.md"),
        specTemplate.replace(/\[Feature Name\]/g, name)
      );
    }
    if (planTemplate) {
      fs.writeFileSync(
        path.join(featurePath, "plan.md"),
        planTemplate.replace(/\[Feature Name\]/g, name)
      );
    }
  }

  // Create empty tasks.md
  const tasksTemplate = readFileSafe(path.join(root, ".specify", "templates", "tasks-template.md"));
  if (tasksTemplate) {
    fs.writeFileSync(
      path.join(featurePath, "tasks.md"),
      tasksTemplate.replace(/\[Feature Name\]/g, name)
    );
  }

  return {
    id: featureId,
    number: featureNumber,
    name,
    path: featurePath,
    hasDataModel: false,
    hasResearch: false,
    hasContracts: false,
  };
}
