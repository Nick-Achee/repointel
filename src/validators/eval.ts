import * as fs from "node:fs";
import * as path from "node:path";
import type {
  EvalResult,
  EvalIssue,
  EvalOptions,
  RepoIndex,
  DepGraph,
  RouteGraph,
} from "../types/index.js";
import { readJson, getGitCommit } from "../core/utils.js";

const EVAL_VERSION = "1.0.0";

/**
 * Validate that a repo index is well-formed
 */
export function validateRepoIndex(
  index: RepoIndex,
  options: EvalOptions
): EvalResult {
  const issues: EvalIssue[] = [];
  const repoRoot = options.root || process.cwd();

  // Check version
  if (!index.version) {
    issues.push({
      severity: "error",
      code: "MISSING_VERSION",
      message: "Index is missing version field",
    });
  }

  // Check all file paths exist
  for (const file of index.files) {
    const absolutePath = path.isAbsolute(file.path)
      ? file.path
      : path.join(repoRoot, file.relativePath);

    if (!fs.existsSync(absolutePath)) {
      issues.push({
        severity: "error",
        code: "FILE_NOT_FOUND",
        message: `File not found: ${file.relativePath}`,
        file: file.relativePath,
      });
    }
  }

  // Check for hash consistency
  for (const file of index.files) {
    if (!file.hash || file.hash.length !== 8) {
      issues.push({
        severity: "warning",
        code: "INVALID_HASH",
        message: `Invalid or missing hash for: ${file.relativePath}`,
        file: file.relativePath,
      });
    }
  }

  // Check summary consistency
  const actualClientComponents = index.files.filter((f) => f.isClientComponent).length;
  if (index.summary.clientComponents !== actualClientComponents) {
    issues.push({
      severity: "warning",
      code: "SUMMARY_MISMATCH",
      message: `Client component count mismatch: summary says ${index.summary.clientComponents}, actual is ${actualClientComponents}`,
    });
  }

  // Check for duplicate paths
  const paths = new Set<string>();
  for (const file of index.files) {
    if (paths.has(file.relativePath)) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_PATH",
        message: `Duplicate file path: ${file.relativePath}`,
        file: file.relativePath,
      });
    }
    paths.add(file.relativePath);
  }

  return {
    version: EVAL_VERSION,
    generatedAt: new Date().toISOString(),
    target: "RepoIndex",
    passed: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    stats: {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      infos: issues.filter((i) => i.severity === "info").length,
    },
  };
}

/**
 * Validate that a dependency graph is well-formed and consistent
 */
export function validateDepGraph(
  graph: DepGraph,
  options: EvalOptions
): EvalResult {
  const issues: EvalIssue[] = [];
  const repoRoot = options.root || process.cwd();

  // Check version
  if (!graph.version) {
    issues.push({
      severity: "error",
      code: "MISSING_VERSION",
      message: "Graph is missing version field",
    });
  }

  // Build node lookup
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  // Check all edge endpoints exist
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      issues.push({
        severity: "error",
        code: "INVALID_EDGE_FROM",
        message: `Edge references non-existent source: ${edge.from}`,
        file: edge.from,
      });
    }
    if (!nodeIds.has(edge.to)) {
      issues.push({
        severity: "error",
        code: "INVALID_EDGE_TO",
        message: `Edge references non-existent target: ${edge.to}`,
        file: edge.to,
      });
    }
  }

  // Check all node files exist
  for (const node of graph.nodes) {
    if (!node.isExternal) {
      const absolutePath = path.isAbsolute(node.path)
        ? node.path
        : path.join(repoRoot, node.id);

      if (!fs.existsSync(absolutePath)) {
        issues.push({
          severity: "error",
          code: "NODE_FILE_NOT_FOUND",
          message: `Node file not found: ${node.id}`,
          file: node.id,
        });
      }
    }
  }

  // Verify cycle detection consistency
  const cycleMembers = new Set(graph.cycles.flat());
  for (const node of graph.nodes) {
    if (node.isCircular && !cycleMembers.has(node.id)) {
      issues.push({
        severity: "warning",
        code: "CYCLE_MARKING_INCONSISTENT",
        message: `Node marked as circular but not in any cycle: ${node.id}`,
        file: node.id,
      });
    }
  }

  // Check stats consistency
  if (graph.stats.totalNodes !== graph.nodes.length) {
    issues.push({
      severity: "warning",
      code: "STATS_MISMATCH",
      message: `Node count mismatch: stats says ${graph.stats.totalNodes}, actual is ${graph.nodes.length}`,
    });
  }

  if (graph.stats.totalEdges !== graph.edges.length) {
    issues.push({
      severity: "warning",
      code: "STATS_MISMATCH",
      message: `Edge count mismatch: stats says ${graph.stats.totalEdges}, actual is ${graph.edges.length}`,
    });
  }

  return {
    version: EVAL_VERSION,
    generatedAt: new Date().toISOString(),
    target: "DepGraph",
    passed: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    stats: {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      infos: issues.filter((i) => i.severity === "info").length,
    },
  };
}

/**
 * Validate that a route graph is well-formed
 */
export function validateRouteGraph(
  graph: RouteGraph,
  options: EvalOptions
): EvalResult {
  const issues: EvalIssue[] = [];
  const repoRoot = options.root || process.cwd();

  // Check version
  if (!graph.version) {
    issues.push({
      severity: "error",
      code: "MISSING_VERSION",
      message: "Graph is missing version field",
    });
  }

  // Build layout lookup
  const layoutIds = new Set(graph.layouts.map((l) => l.id));

  // Check all route files exist
  for (const route of graph.routes) {
    const absolutePath = path.join(repoRoot, route.file);
    if (!fs.existsSync(absolutePath)) {
      issues.push({
        severity: "error",
        code: "ROUTE_FILE_NOT_FOUND",
        message: `Route file not found: ${route.file}`,
        file: route.file,
      });
    }

    // Check parent layout exists
    if (route.parentLayout && !layoutIds.has(route.parentLayout)) {
      issues.push({
        severity: "warning",
        code: "INVALID_PARENT_LAYOUT",
        message: `Route references non-existent parent layout: ${route.parentLayout}`,
        file: route.file,
      });
    }
  }

  // Check layout files exist
  for (const layout of graph.layouts) {
    const absolutePath = path.join(repoRoot, layout.file);
    if (!fs.existsSync(absolutePath)) {
      issues.push({
        severity: "error",
        code: "LAYOUT_FILE_NOT_FOUND",
        message: `Layout file not found: ${layout.file}`,
        file: layout.file,
      });
    }
  }

  // Check middleware files exist
  for (const mw of graph.middleware) {
    const absolutePath = path.join(repoRoot, mw.file);
    if (!fs.existsSync(absolutePath)) {
      issues.push({
        severity: "error",
        code: "MIDDLEWARE_FILE_NOT_FOUND",
        message: `Middleware file not found: ${mw.file}`,
        file: mw.file,
      });
    }
  }

  // Check for duplicate route paths
  const routePaths = new Map<string, string>();
  for (const route of graph.routes) {
    const key = route.routePath + ":" + route.type;
    if (routePaths.has(key)) {
      issues.push({
        severity: "warning",
        code: "DUPLICATE_ROUTE",
        message: `Duplicate route: ${route.routePath} (${route.type})`,
        file: route.file,
      });
    }
    routePaths.set(key, route.file);
  }

  return {
    version: EVAL_VERSION,
    generatedAt: new Date().toISOString(),
    target: "RouteGraph",
    passed: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    stats: {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      infos: issues.filter((i) => i.severity === "info").length,
    },
  };
}

/**
 * Validate an artifact file (auto-detect type)
 */
export async function validateArtifact(options: EvalOptions): Promise<EvalResult> {
  const { target, root = process.cwd() } = options;

  // Read and parse target file
  const data = readJson<Record<string, unknown>>(target);

  if (!data) {
    return {
      version: EVAL_VERSION,
      generatedAt: new Date().toISOString(),
      target,
      passed: false,
      issues: [
        {
          severity: "error",
          code: "FILE_NOT_FOUND",
          message: `Could not read file: ${target}`,
          file: target,
        },
      ],
      stats: { errors: 1, warnings: 0, infos: 0 },
    };
  }

  // Detect type and validate
  if ("files" in data && "summary" in data) {
    return validateRepoIndex(data as unknown as RepoIndex, options);
  }

  if ("nodes" in data && "edges" in data && "cycles" in data) {
    return validateDepGraph(data as unknown as DepGraph, options);
  }

  if ("routes" in data && "layouts" in data && "framework" in data) {
    return validateRouteGraph(data as unknown as RouteGraph, options);
  }

  return {
    version: EVAL_VERSION,
    generatedAt: new Date().toISOString(),
    target,
    passed: false,
    issues: [
      {
        severity: "error",
        code: "UNKNOWN_TYPE",
        message: "Could not determine artifact type",
        file: target,
      },
    ],
    stats: { errors: 1, warnings: 0, infos: 0 },
  };
}

/**
 * Validate all artifacts in .repointel directory
 */
export async function validateAll(root: string = process.cwd()): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  const repointelDir = path.join(root, ".repointel");

  if (!fs.existsSync(repointelDir)) {
    return [
      {
        version: EVAL_VERSION,
        generatedAt: new Date().toISOString(),
        target: repointelDir,
        passed: false,
        issues: [
          {
            severity: "error",
            code: "NO_ARTIFACTS",
            message: "No .repointel directory found. Run 'repointel scan' first.",
          },
        ],
        stats: { errors: 1, warnings: 0, infos: 0 },
      },
    ];
  }

  // Check index
  const indexPath = path.join(repointelDir, "index.json");
  if (fs.existsSync(indexPath)) {
    results.push(await validateArtifact({ target: indexPath, root }));
  }

  // Check graphs
  const graphsDir = path.join(repointelDir, "graphs");
  if (fs.existsSync(graphsDir)) {
    const graphFiles = fs.readdirSync(graphsDir).filter((f) => f.endsWith(".json"));
    for (const file of graphFiles) {
      results.push(await validateArtifact({ target: path.join(graphsDir, file), root }));
    }
  }

  return results;
}
