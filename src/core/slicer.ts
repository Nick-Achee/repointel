import * as path from "node:path";
import * as fs from "node:fs";
import type {
  ContextSlice,
  SliceFile,
  SliceType,
  FileType,
  RepoIndex,
  SliceOptions,
  LLMModel,
  ModelConfig,
} from "../types/index.js";
import { MODEL_CONFIGS } from "../types/index.js";
import {
  getGitCommit,
  readFileSafe,
  writeJson,
  formatBytes,
  filePathToRoutePath,
  matchesPatterns,
} from "./utils.js";
import { getIndex } from "./indexer.js";
import { buildDepGraphFromSeeds } from "./dep-graph.js";

const SLICE_VERSION = "1.0.0";

/**
 * Estimate token count from text
 * Uses character-based approximation: ~4 chars per token for code
 * This is a rough estimate; actual tokenization varies by model
 */
function estimateTokens(text: string): number {
  // Code tends to have more tokens per character than prose
  // Average is ~4 chars per token for English, ~3.5 for code
  return Math.ceil(text.length / 3.5);
}

/**
 * Get model configuration
 */
function getModelConfig(model: LLMModel, customConfig?: ModelConfig): ModelConfig {
  if (model === "custom" && customConfig) {
    return customConfig;
  }
  return MODEL_CONFIGS[model as Exclude<LLMModel, "custom">];
}

/**
 * Calculate available token budget for input
 */
function calculateTokenBudget(config: ModelConfig): number {
  return config.contextWindow - config.reserveForOutput;
}

/**
 * Find the page and layout files for a route
 */
function findRouteFiles(index: RepoIndex, routePath: string): string[] {
  const normalized = routePath.startsWith("/") ? routePath : "/" + routePath;
  const files: string[] = [];

  for (const file of index.files) {
    if (file.routePath === normalized) {
      files.push(file.relativePath);
    }
  }

  return files;
}

/**
 * Find all parent layouts for a route
 */
function findParentLayouts(index: RepoIndex, routePath: string): string[] {
  const normalized = routePath.startsWith("/") ? routePath : "/" + routePath;
  const segments = normalized.split("/").filter(Boolean);
  const layouts: string[] = [];

  // Check each ancestor path for layouts
  for (let i = 0; i <= segments.length; i++) {
    const ancestorPath = i === 0 ? "/" : "/" + segments.slice(0, i).join("/");

    for (const file of index.files) {
      if (file.type === "layout" && file.routePath === ancestorPath) {
        layouts.push(file.relativePath);
      }
    }
  }

  return layouts;
}

/**
 * Infer file type from path
 */
function inferFileType(relativePath: string): FileType {
  if (relativePath.startsWith("convex/")) return "schema";
  if (relativePath.includes("/page.")) return "page";
  if (relativePath.includes("/layout.")) return "layout";
  if (relativePath.includes("/loading.")) return "loading";
  if (relativePath.includes("/error.")) return "error";
  if (relativePath.includes("/route.")) return "route";
  if (relativePath.includes("middleware.")) return "middleware";
  if (relativePath.match(/\/hooks?\//i) || relativePath.match(/\/use[A-Z]/)) return "hook";
  if (relativePath.match(/\/lib\//i) || relativePath.match(/\/utils?\//i)) return "lib";
  if (relativePath.match(/\/types?\//i)) return "type";
  return "component";
}

/**
 * Build a context slice for a route
 */
export async function sliceRoute(
  routePath: string,
  options: SliceOptions = {}
): Promise<ContextSlice> {
  const root = options.root || process.cwd();
  const maxFileBytes = options.maxFileBytes || 400 * 1024; // 400KB default
  const depth = options.depth || 5;
  const exclude = options.exclude || [];

  // Get model config for token budgeting
  const modelConfig = options.model
    ? getModelConfig(options.model, options.customModelConfig)
    : null;

  // Calculate budget (prefer tokens if model specified, else bytes)
  const tokenBudget = modelConfig
    ? options.maxTokens || calculateTokenBudget(modelConfig)
    : null;
  const maxBytes = options.maxBytes || 8 * 1024 * 1024;

  const index = await getIndex({ root });

  // Find seed files for this route
  const routeFiles = findRouteFiles(index, routePath);
  const layoutFiles = findParentLayouts(index, routePath);
  const seedFiles = [...new Set([...routeFiles, ...layoutFiles])];

  if (seedFiles.length === 0) {
    throw new Error(`No files found for route: ${routePath}`);
  }

  // Build dependency graph from seeds
  const depGraph = await buildDepGraphFromSeeds(seedFiles, { root, depth });

  // Collect files with metadata
  const files: SliceFile[] = [];
  const excluded: ContextSlice["excluded"] = [];
  let totalBytes = 0;
  let totalTokens = 0;

  // Sort by depth for deterministic output
  const sortedNodes = [...depGraph.nodes].sort((a, b) => {
    const depthDiff = (a.depth || 0) - (b.depth || 0);
    if (depthDiff !== 0) return depthDiff;
    return a.id.localeCompare(b.id);
  });

  for (const node of sortedNodes) {
    const relativePath = node.id;
    const absolutePath = path.join(root, relativePath);

    // Check exclusion patterns
    if (matchesPatterns(relativePath, exclude)) {
      excluded.push({ file: relativePath, reason: "pattern" });
      continue;
    }

    // Get file content and size
    let sizeBytes = 0;
    let content = "";
    try {
      sizeBytes = fs.statSync(absolutePath).size;
      content = readFileSafe(absolutePath) || "";
    } catch {
      excluded.push({ file: relativePath, reason: "external" });
      continue;
    }

    // Check file size limit
    if (sizeBytes > maxFileBytes) {
      excluded.push({ file: relativePath, reason: "size" });
      continue;
    }

    // Estimate tokens for this file
    const fileTokens = estimateTokens(content);

    // Check budget (tokens if model specified, else bytes)
    if (tokenBudget !== null) {
      if (totalTokens + fileTokens > tokenBudget) {
        excluded.push({ file: relativePath, reason: "token_budget" });
        continue;
      }
    } else if (totalBytes + sizeBytes > maxBytes) {
      excluded.push({ file: relativePath, reason: "size" });
      continue;
    }

    // Determine reason
    let reason: SliceFile["reason"] = "import";
    if (seedFiles.includes(relativePath)) {
      reason = layoutFiles.includes(relativePath) ? "layout" : "seed";
    } else if (relativePath.startsWith("convex/")) {
      reason = "schema";
    }

    files.push({
      relativePath,
      type: node.type || inferFileType(relativePath),
      sizeBytes,
      depth: node.depth || 0,
      reason,
    });

    totalBytes += sizeBytes;
    totalTokens += fileTokens;
  }

  // Build type counts
  const byType: Record<FileType, number> = {} as Record<FileType, number>;
  for (const file of files) {
    byType[file.type] = (byType[file.type] || 0) + 1;
  }

  // Build result
  const result: ContextSlice = {
    version: SLICE_VERSION,
    generatedAt: new Date().toISOString(),
    gitCommit: getGitCommit(root),
    type: "route",
    name: routePath,
    seedFiles,
    files,
    excluded,
    summary: {
      totalFiles: files.length,
      totalBytes,
      totalTokens,
      maxDepth: Math.max(...files.map((f) => f.depth), 0),
      byType,
    },
  };

  // Add token budget info if model specified
  if (modelConfig && tokenBudget !== null) {
    result.model = options.model;
    result.tokenBudget = {
      model: modelConfig.name,
      contextWindow: modelConfig.contextWindow,
      reservedForOutput: modelConfig.reserveForOutput,
      availableForInput: tokenBudget,
      used: totalTokens,
      remaining: tokenBudget - totalTokens,
      estimatedCost: modelConfig.costPer1kInput
        ? (totalTokens / 1000) * modelConfig.costPer1kInput
        : undefined,
    };
  }

  return result;
}

/**
 * Build a context slice from seed files
 */
export async function sliceFeature(
  seeds: string[],
  name: string,
  options: SliceOptions = {}
): Promise<ContextSlice> {
  const root = options.root || process.cwd();
  const maxFileBytes = options.maxFileBytes || 400 * 1024;
  const depth = options.depth || 5;
  const exclude = options.exclude || [];

  // Get model config for token budgeting
  const modelConfig = options.model
    ? getModelConfig(options.model, options.customModelConfig)
    : null;

  // Calculate budget (prefer tokens if model specified, else bytes)
  const tokenBudget = modelConfig
    ? options.maxTokens || calculateTokenBudget(modelConfig)
    : null;
  const maxBytes = options.maxBytes || 8 * 1024 * 1024;

  // Build dependency graph from seeds
  const depGraph = await buildDepGraphFromSeeds(seeds, { root, depth });

  // Collect files
  const files: SliceFile[] = [];
  const excluded: ContextSlice["excluded"] = [];
  let totalBytes = 0;
  let totalTokens = 0;

  const seedSet = new Set(seeds);
  const sortedNodes = [...depGraph.nodes].sort((a, b) => {
    const depthDiff = (a.depth || 0) - (b.depth || 0);
    if (depthDiff !== 0) return depthDiff;
    return a.id.localeCompare(b.id);
  });

  for (const node of sortedNodes) {
    const relativePath = node.id;
    const absolutePath = path.join(root, relativePath);

    if (matchesPatterns(relativePath, exclude)) {
      excluded.push({ file: relativePath, reason: "pattern" });
      continue;
    }

    let sizeBytes = 0;
    let content = "";
    try {
      sizeBytes = fs.statSync(absolutePath).size;
      content = readFileSafe(absolutePath) || "";
    } catch {
      excluded.push({ file: relativePath, reason: "external" });
      continue;
    }

    if (sizeBytes > maxFileBytes) {
      excluded.push({ file: relativePath, reason: "size" });
      continue;
    }

    // Estimate tokens for this file
    const fileTokens = estimateTokens(content);

    // Check budget (tokens if model specified, else bytes)
    if (tokenBudget !== null) {
      if (totalTokens + fileTokens > tokenBudget) {
        excluded.push({ file: relativePath, reason: "token_budget" });
        continue;
      }
    } else if (totalBytes + sizeBytes > maxBytes) {
      excluded.push({ file: relativePath, reason: "size" });
      continue;
    }

    let reason: SliceFile["reason"] = "import";
    if (seedSet.has(relativePath)) {
      reason = "seed";
    } else if (relativePath.startsWith("convex/")) {
      reason = "schema";
    }

    files.push({
      relativePath,
      type: node.type || inferFileType(relativePath),
      sizeBytes,
      depth: node.depth || 0,
      reason,
    });

    totalBytes += sizeBytes;
    totalTokens += fileTokens;
  }

  const byType: Record<FileType, number> = {} as Record<FileType, number>;
  for (const file of files) {
    byType[file.type] = (byType[file.type] || 0) + 1;
  }

  // Build result
  const result: ContextSlice = {
    version: SLICE_VERSION,
    generatedAt: new Date().toISOString(),
    gitCommit: getGitCommit(root),
    type: "feature",
    name,
    seedFiles: seeds,
    files,
    excluded,
    summary: {
      totalFiles: files.length,
      totalBytes,
      totalTokens,
      maxDepth: Math.max(...files.map((f) => f.depth), 0),
      byType,
    },
  };

  // Add token budget info if model specified
  if (modelConfig && tokenBudget !== null) {
    result.model = options.model;
    result.tokenBudget = {
      model: modelConfig.name,
      contextWindow: modelConfig.contextWindow,
      reservedForOutput: modelConfig.reserveForOutput,
      availableForInput: tokenBudget,
      used: totalTokens,
      remaining: tokenBudget - totalTokens,
      estimatedCost: modelConfig.costPer1kInput
        ? (totalTokens / 1000) * modelConfig.costPer1kInput
        : undefined,
    };
  }

  return result;
}

/**
 * Generate a context pack with file contents
 */
export async function generateContextPack(
  slice: ContextSlice,
  root: string
): Promise<string> {
  const lines: string[] = [];

  lines.push(`# Context Pack: ${slice.name}`);
  lines.push("");
  lines.push(`Type: ${slice.type}`);
  lines.push(`Generated: ${slice.generatedAt}`);
  if (slice.gitCommit) {
    lines.push(`Git: ${slice.gitCommit.slice(0, 8)}`);
  }
  lines.push(`Files: ${slice.summary.totalFiles}`);
  lines.push(`Size: ${formatBytes(slice.summary.totalBytes)}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // File manifest
  lines.push("## Files Included");
  lines.push("");
  for (const file of slice.files) {
    lines.push(`- \`${file.relativePath}\` (${file.type}, ${formatBytes(file.sizeBytes)})`);
  }
  lines.push("");

  if (slice.excluded.length > 0) {
    lines.push("## Files Excluded");
    lines.push("");
    for (const ex of slice.excluded) {
      lines.push(`- \`${ex.file}\` (${ex.reason})`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Source Files");
  lines.push("");

  // File contents
  for (const file of slice.files) {
    const absolutePath = path.join(root, file.relativePath);
    const content = readFileSafe(absolutePath);

    if (content) {
      const ext = path.extname(file.relativePath).slice(1) || "txt";
      lines.push(`### ${file.relativePath}`);
      lines.push("");
      lines.push("```" + ext);
      lines.push(content.trim());
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Save slice to disk
 */
export function saveSlice(slice: ContextSlice, outputPath: string): string {
  writeJson(outputPath, slice);
  return outputPath;
}

/**
 * Save context pack to disk
 */
export function saveContextPack(content: string, outputPath: string): string {
  fs.writeFileSync(outputPath, content);
  return outputPath;
}
