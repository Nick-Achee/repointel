import * as path from "node:path";
import * as fs from "node:fs";
import type {
  DepGraph,
  DepNode,
  DepEdge,
  RepoIndex,
  FileType,
  GraphOptions,
} from "../types/index.js";
import {
  getGitCommit,
  readFileSafe,
  writeJson,
  readJson,
} from "./utils.js";
import { getIndex } from "./indexer.js";

const GRAPH_VERSION = "1.0.0";

interface TsConfigPaths {
  baseUrl?: string;
  paths?: Record<string, string[]>;
}

/**
 * Load tsconfig path aliases
 */
function loadTsConfigPaths(repoRoot: string): TsConfigPaths {
  const tsconfigPath = path.join(repoRoot, "tsconfig.json");
  const content = readFileSafe(tsconfigPath);
  if (!content) return {};

  try {
    const tsconfig = JSON.parse(content);
    return {
      baseUrl: tsconfig.compilerOptions?.baseUrl,
      paths: tsconfig.compilerOptions?.paths,
    };
  } catch {
    return {};
  }
}

/**
 * Try to resolve a file path with various extensions
 * Handles ESM imports with .js extensions that map to .ts files
 */
function tryResolveFile(basePath: string, repoRoot: string): string | null {
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mjs"];

  // Strip existing extension to normalize the base path
  // This handles ESM imports like "./utils.js" -> "./utils"
  const stripped = basePath.replace(/\.(tsx?|jsx?|mjs)$/, "");

  // Try with each extension
  for (const ext of extensions) {
    const fullPath = stripped + ext;
    const absolutePath = path.join(repoRoot, fullPath);
    if (fs.existsSync(absolutePath)) {
      return fullPath;
    }
  }

  // Try index files (for directory imports)
  for (const ext of extensions) {
    const indexPath = path.join(stripped, `index${ext}`);
    const absolutePath = path.join(repoRoot, indexPath);
    if (fs.existsSync(absolutePath)) {
      return indexPath;
    }
  }

  return null;
}

/**
 * Resolve import specifier to relative file path
 */
function resolveImport(
  importSpec: string,
  fromFile: string,
  repoRoot: string,
  tsConfig: TsConfigPaths
): { path: string | null; isExternal: boolean } {
  // External package
  if (
    !importSpec.startsWith(".") &&
    !importSpec.startsWith("@/") &&
    !importSpec.startsWith("~/") &&
    !importSpec.startsWith("#")
  ) {
    return { path: null, isExternal: true };
  }

  // Handle @/ alias (common in Next.js)
  if (importSpec.startsWith("@/")) {
    const aliasPath = importSpec.replace("@/", "src/");
    const resolved = tryResolveFile(aliasPath, repoRoot);
    return { path: resolved, isExternal: false };
  }

  // Handle ~/ alias
  if (importSpec.startsWith("~/")) {
    const aliasPath = importSpec.replace("~/", "");
    const resolved = tryResolveFile(aliasPath, repoRoot);
    return { path: resolved, isExternal: false };
  }

  // Handle relative imports
  if (importSpec.startsWith(".")) {
    const fromDir = path.dirname(fromFile);
    const relativePath = path.join(fromDir, importSpec);
    const normalized = path.normalize(relativePath);
    const resolved = tryResolveFile(normalized, repoRoot);
    return { path: resolved, isExternal: false };
  }

  return { path: null, isExternal: true };
}

/**
 * Determine import type from import statement
 */
function getImportType(content: string, importSpec: string): DepEdge["type"] {
  // Type-only imports
  const typeOnlyPattern = new RegExp(
    `import\\s+type\\s+.*?['"]${importSpec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`
  );
  if (typeOnlyPattern.test(content)) {
    return "type-only";
  }

  // Dynamic imports
  const dynamicPattern = new RegExp(
    `import\\s*\\(\\s*['"]${importSpec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`
  );
  if (dynamicPattern.test(content)) {
    return "dynamic";
  }

  return "static";
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
  if (relativePath.match(/\/server\//i) || relativePath.match(/\/api\//i)) return "api";
  return "component";
}

/**
 * Detect cycles in the graph using DFS
 */
function detectCycles(edges: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const currentPath: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    recursionStack.add(node);
    currentPath.push(node);

    const neighbors = edges.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recursionStack.has(neighbor)) {
        // Found a cycle
        const cycleStart = currentPath.indexOf(neighbor);
        if (cycleStart !== -1) {
          cycles.push([...currentPath.slice(cycleStart)]);
        }
      }
    }

    currentPath.pop();
    recursionStack.delete(node);
  }

  for (const node of edges.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

/**
 * Build dependency graph from repo index
 */
export async function buildDepGraph(options: GraphOptions = {}): Promise<DepGraph> {
  const repoRoot = options.root || process.cwd();
  const index = await getIndex({ root: repoRoot });
  const tsConfig = loadTsConfigPaths(repoRoot);

  const nodes: DepNode[] = [];
  const edges: DepEdge[] = [];
  const edgeMap = new Map<string, string[]>();
  const externalDeps = new Set<string>();

  // Build lookup map from index
  const fileMap = new Map<string, (typeof index.files)[0]>();
  for (const file of index.files) {
    fileMap.set(file.relativePath, file);
  }

  // Process each file
  for (const file of index.files) {
    // Add node
    nodes.push({
      id: file.relativePath,
      path: file.path,
      type: file.type,
      isExternal: false,
    });

    const resolvedImports: string[] = [];
    const content = readFileSafe(file.path) || "";

    for (const importSpec of file.imports) {
      const { path: resolvedPath, isExternal } = resolveImport(
        importSpec,
        file.relativePath,
        repoRoot,
        tsConfig
      );

      if (isExternal) {
        // Track external dependency
        const pkgName = importSpec.startsWith("@")
          ? importSpec.split("/").slice(0, 2).join("/")
          : importSpec.split("/")[0];
        externalDeps.add(pkgName);
        continue;
      }

      if (resolvedPath) {
        resolvedImports.push(resolvedPath);

        // Add edge
        edges.push({
          from: file.relativePath,
          to: resolvedPath,
          type: getImportType(content, importSpec),
        });
      }
    }

    edgeMap.set(file.relativePath, resolvedImports);
  }

  // Detect cycles
  const cycles = detectCycles(edgeMap);
  const cycleMembers = new Set(cycles.flat());

  // Mark circular nodes
  for (const node of nodes) {
    if (cycleMembers.has(node.id)) {
      node.isCircular = true;
    }
  }

  // Calculate stats
  const depCounts = new Map<string, number>();
  for (const edge of edges) {
    depCounts.set(edge.from, (depCounts.get(edge.from) || 0) + 1);
  }

  let maxDepsFile = "";
  let maxDepsCount = 0;
  for (const [file, count] of depCounts) {
    if (count > maxDepsCount) {
      maxDepsFile = file;
      maxDepsCount = count;
    }
  }

  return {
    version: GRAPH_VERSION,
    generatedAt: new Date().toISOString(),
    gitCommit: getGitCommit(repoRoot),
    repoRoot,
    nodes,
    edges,
    cycles,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      externalDeps: externalDeps.size,
      circularDeps: cycles.length,
      avgDepsPerFile: nodes.length > 0 ? edges.length / nodes.length : 0,
      maxDeps: { file: maxDepsFile, count: maxDepsCount },
    },
  };
}

/**
 * Build dependency graph starting from seed files
 */
export async function buildDepGraphFromSeeds(
  seeds: string[],
  options: GraphOptions = {}
): Promise<DepGraph> {
  const repoRoot = options.root || process.cwd();
  const maxDepth = options.depth || 10;
  const index = await getIndex({ root: repoRoot });
  const tsConfig = loadTsConfigPaths(repoRoot);

  const nodes: DepNode[] = [];
  const edges: DepEdge[] = [];
  const edgeMap = new Map<string, string[]>();
  const visited = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [];

  // Build lookup map
  const fileMap = new Map<string, (typeof index.files)[0]>();
  for (const file of index.files) {
    fileMap.set(file.relativePath, file);
  }

  // Initialize queue with seeds
  for (const seed of seeds) {
    queue.push({ path: seed, depth: 0 });
  }

  // BFS traversal
  while (queue.length > 0) {
    const { path: currentPath, depth } = queue.shift()!;

    if (visited.has(currentPath)) continue;
    if (depth > maxDepth) continue;

    visited.add(currentPath);

    const fileInfo = fileMap.get(currentPath);
    const absolutePath = path.join(repoRoot, currentPath);
    const content = readFileSafe(absolutePath) || "";

    // Add node
    nodes.push({
      id: currentPath,
      path: absolutePath,
      type: fileInfo?.type || inferFileType(currentPath),
      isExternal: false,
      depth,
    });

    const imports = fileInfo?.imports || [];
    const resolvedImports: string[] = [];

    for (const importSpec of imports) {
      const { path: resolvedPath, isExternal } = resolveImport(
        importSpec,
        currentPath,
        repoRoot,
        tsConfig
      );

      if (isExternal || !resolvedPath) continue;

      resolvedImports.push(resolvedPath);

      edges.push({
        from: currentPath,
        to: resolvedPath,
        type: getImportType(content, importSpec),
      });

      if (!visited.has(resolvedPath)) {
        queue.push({ path: resolvedPath, depth: depth + 1 });
      }
    }

    edgeMap.set(currentPath, resolvedImports);
  }

  // Detect cycles
  const cycles = detectCycles(edgeMap);
  const cycleMembers = new Set(cycles.flat());

  for (const node of nodes) {
    if (cycleMembers.has(node.id)) {
      node.isCircular = true;
    }
  }

  // Stats
  const depCounts = new Map<string, number>();
  for (const edge of edges) {
    depCounts.set(edge.from, (depCounts.get(edge.from) || 0) + 1);
  }

  let maxDepsFile = "";
  let maxDepsCount = 0;
  for (const [file, count] of depCounts) {
    if (count > maxDepsCount) {
      maxDepsFile = file;
      maxDepsCount = count;
    }
  }

  return {
    version: GRAPH_VERSION,
    generatedAt: new Date().toISOString(),
    gitCommit: getGitCommit(repoRoot),
    repoRoot,
    nodes,
    edges,
    cycles,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      externalDeps: 0,
      circularDeps: cycles.length,
      avgDepsPerFile: nodes.length > 0 ? edges.length / nodes.length : 0,
      maxDeps: { file: maxDepsFile, count: maxDepsCount },
    },
  };
}

/**
 * Save dep graph to disk
 */
export function saveDepGraph(graph: DepGraph, outputPath?: string): string {
  const filePath = outputPath || path.join(graph.repoRoot, ".repointel", "graphs", "deps.json");
  writeJson(filePath, graph);
  return filePath;
}

/**
 * Load dep graph from disk
 */
export function loadDepGraph(repoRoot: string): DepGraph | null {
  const filePath = path.join(repoRoot, ".repointel", "graphs", "deps.json");
  return readJson<DepGraph>(filePath);
}

/**
 * Generate Mermaid diagram from dep graph
 */
export function depGraphToMermaid(
  graph: DepGraph,
  options: { maxNodes?: number; direction?: "TD" | "LR" } = {}
): string {
  const maxNodes = options.maxNodes || 50;
  const direction = options.direction || "TD";

  const lines: string[] = [`graph ${direction}`];

  // Limit nodes
  const nodesToShow = graph.nodes.slice(0, maxNodes);
  const nodeIds = new Set(nodesToShow.map((n) => n.id));

  // Add nodes with styling
  for (const node of nodesToShow) {
    const label = path.basename(node.id).replace(/\.[^.]+$/, "");
    const shape = node.type === "page" ? `[["${label}"]]` : `["${label}"]`;
    const id = sanitizeId(node.id);

    if (node.isCircular) {
      lines.push(`  ${id}${shape}:::circular`);
    } else {
      lines.push(`  ${id}${shape}:::${node.type}`);
    }
  }

  // Add edges
  for (const edge of graph.edges) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
      const fromId = sanitizeId(edge.from);
      const toId = sanitizeId(edge.to);
      const arrow = edge.type === "dynamic" ? "-.->" : "-->";
      lines.push(`  ${fromId} ${arrow} ${toId}`);
    }
  }

  // Add styles
  lines.push("");
  lines.push("  classDef page fill:#e1f5fe,stroke:#01579b");
  lines.push("  classDef layout fill:#f3e5f5,stroke:#4a148c");
  lines.push("  classDef component fill:#e8f5e9,stroke:#1b5e20");
  lines.push("  classDef lib fill:#fff3e0,stroke:#e65100");
  lines.push("  classDef hook fill:#fce4ec,stroke:#880e4f");
  lines.push("  classDef circular fill:#ffebee,stroke:#c62828,stroke-width:2px");

  return lines.join("\n");
}

/**
 * Sanitize node ID for Mermaid
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}
