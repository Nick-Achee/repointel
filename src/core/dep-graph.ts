import * as path from "node:path";
import * as fs from "node:fs";
import type {
  DepGraph,
  DepNode,
  DepEdge,
  ImpactDetail,
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
 * Strip JSONC comments and trailing commas (tsconfig.json is JSONC, not JSON)
 */
function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\" && next !== undefined) {
        out += next;
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }

  return out.replace(/,\s*([}\]])/g, "$1");
}

/**
 * Load tsconfig path aliases, following relative `extends` chains
 */
function loadTsConfigPaths(repoRoot: string): TsConfigPaths {
  return readTsConfig(path.join(repoRoot, "tsconfig.json"), 0);
}

function readTsConfig(configPath: string, depth: number): TsConfigPaths {
  if (depth > 5) return {};
  const content = readFileSafe(configPath);
  if (!content) return {};

  try {
    const parsed = JSON.parse(stripJsonComments(content));

    let base: TsConfigPaths = {};
    if (typeof parsed.extends === "string" && parsed.extends.startsWith(".")) {
      let extendsPath = path.resolve(path.dirname(configPath), parsed.extends);
      if (!extendsPath.endsWith(".json")) extendsPath += ".json";
      base = readTsConfig(extendsPath, depth + 1);
    }

    return {
      baseUrl: parsed.compilerOptions?.baseUrl ?? base.baseUrl,
      paths: { ...(base.paths || {}), ...(parsed.compilerOptions?.paths || {}) },
    };
  } catch {
    return {};
  }
}

/**
 * Resolve an import specifier through tsconfig `paths` mappings.
 * Returns the resolved repo-relative file path, or null if no mapping matched.
 */
function resolveViaTsConfigPaths(
  importSpec: string,
  repoRoot: string,
  tsConfig: TsConfigPaths
): string | null {
  const paths = tsConfig.paths;
  if (!paths) return null;
  const baseDir = tsConfig.baseUrl || ".";

  for (const [pattern, targets] of Object.entries(paths)) {
    const starIdx = pattern.indexOf("*");
    let matched: string | null = null;

    if (starIdx === -1) {
      if (importSpec === pattern) matched = "";
      else continue;
    } else {
      const prefix = pattern.slice(0, starIdx);
      const suffix = pattern.slice(starIdx + 1);
      if (
        importSpec.startsWith(prefix) &&
        importSpec.endsWith(suffix) &&
        importSpec.length >= prefix.length + suffix.length
      ) {
        matched = importSpec.slice(
          prefix.length,
          importSpec.length - suffix.length
        );
      } else {
        continue;
      }
    }

    for (const target of targets) {
      const candidate = path.normalize(
        path.join(baseDir, target.replace("*", matched))
      );
      const resolved = tryResolveFile(candidate, repoRoot);
      if (resolved) return resolved;
    }
  }

  return null;
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
  // Relative imports
  if (importSpec.startsWith(".")) {
    const fromDir = path.dirname(fromFile);
    const relativePath = path.join(fromDir, importSpec);
    const normalized = path.normalize(relativePath);
    const resolved = tryResolveFile(normalized, repoRoot);
    return { path: resolved, isExternal: false };
  }

  // tsconfig path aliases — checked before the external guard so custom
  // aliases like @lib/* are not misclassified as external packages
  const aliased = resolveViaTsConfigPaths(importSpec, repoRoot, tsConfig);
  if (aliased) {
    return { path: aliased, isExternal: false };
  }

  // Fallback heuristics for repos without tsconfig paths
  if (importSpec.startsWith("@/")) {
    const resolved =
      tryResolveFile(importSpec.replace("@/", "src/"), repoRoot) ??
      tryResolveFile(importSpec.replace("@/", ""), repoRoot);
    return { path: resolved, isExternal: false };
  }
  if (importSpec.startsWith("~/")) {
    const resolved = tryResolveFile(importSpec.replace("~/", ""), repoRoot);
    return { path: resolved, isExternal: false };
  }
  if (importSpec.startsWith("#")) {
    return { path: null, isExternal: true };
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
  const index = await getIndex({
    root: repoRoot,
    includeTests: options.includeTests,
  });
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
      symbolRefs: file.symbolRefs,
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
          symbols: file.importBindings?.[importSpec],
          line: file.importLines?.[importSpec],
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
 * Expand seed entries: a seed naming a directory becomes every indexed file
 * under it; file seeds pass through unchanged. Seeds matching nothing are
 * kept as-is so callers can decide how to report them.
 */
export function expandSeeds(seeds: string[], index: RepoIndex): string[] {
  const known = new Set(index.files.map((f) => f.relativePath));
  const expanded: string[] = [];

  for (const seed of seeds) {
    const normalized = seed
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "");

    if (known.has(normalized)) {
      expanded.push(normalized);
      continue;
    }

    const prefix = normalized + "/";
    const matches = index.files
      .map((f) => f.relativePath)
      .filter((p) => p.startsWith(prefix));

    if (matches.length > 0) {
      expanded.push(...matches);
    } else {
      expanded.push(seed);
    }
  }

  return [...new Set(expanded)];
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

  // Initialize queue with seeds (directories expand to their files)
  for (const seed of expandSeeds(seeds, index)) {
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
 * Reverse-dependency (impact) analysis: which files break if the targets change.
 * `direct` = files that import a target. `transitive` = everything else upstream,
 * excluding the targets themselves.
 */
export function findDependents(
  graph: DepGraph,
  targets: string[],
  options: { symbol?: string } = {}
): {
  direct: string[];
  transitive: string[];
  all: string[];
  details: ImpactDetail[];
} {
  const importers = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = importers.get(edge.to);
    if (list) list.push(edge.from);
    else importers.set(edge.to, [edge.from]);
  }

  const targetSet = new Set(targets);
  const direct = new Set<string>();

  if (options.symbol) {
    // Changing a symbol also changes any sibling export that delegates to it,
    // so importers of those wrappers are affected too.
    const affectedSymbols = new Set([options.symbol]);
    for (const target of targets) {
      const refs = graph.nodes.find((n) => n.id === target)?.symbolRefs;
      if (!refs) continue;
      let grew = true;
      while (grew) {
        grew = false;
        for (const [exported, referenced] of Object.entries(refs)) {
          if (affectedSymbols.has(exported)) continue;
          if (referenced.some((r) => affectedSymbols.has(r))) {
            affectedSymbols.add(exported);
            grew = true;
          }
        }
      }
    }

    // Only importers that bind an affected symbol count. A namespace import
    // (`* as ns`) may use anything, so it always counts.
    for (const edge of graph.edges) {
      if (!targetSet.has(edge.to) || targetSet.has(edge.from)) continue;
      const symbols = edge.symbols;
      if (
        !symbols ||
        symbols.includes("*") ||
        symbols.some((s) => affectedSymbols.has(s))
      ) {
        direct.add(edge.from);
      }
    }
  } else {
    for (const target of targets) {
      for (const importer of importers.get(target) || []) {
        if (!targetSet.has(importer)) direct.add(importer);
      }
    }
  }

  // Walk upstream from the direct importers, recording how each file was
  // reached so consumers can see the blast radius in order.
  const edgeBetween = new Map<string, DepEdge>();
  for (const edge of graph.edges) {
    const key = `${edge.from} ${edge.to}`;
    if (!edgeBetween.has(key)) edgeBetween.set(key, edge);
  }
  const describe = (file: string, via: string, depth: number): ImpactDetail => {
    const edge = edgeBetween.get(`${file} ${via}`);
    return { file, depth, via, symbols: edge?.symbols, line: edge?.line };
  };

  const details: ImpactDetail[] = [];
  const seen = new Set<string>(direct);

  for (const file of [...direct].sort()) {
    const via = targets.find((t) =>
      edgeBetween.has(`${file} ${t}`)
    );
    details.push(describe(file, via ?? targets[0], 1));
  }

  let frontier = [...direct].sort();
  let depth = 2;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const importer of (importers.get(current) || []).sort()) {
        if (targetSet.has(importer) || seen.has(importer)) continue;
        seen.add(importer);
        details.push(describe(importer, current, depth));
        next.push(importer);
      }
    }
    frontier = next;
    depth++;
  }

  const transitive = [...seen].filter((f) => !direct.has(f)).sort();
  return {
    direct: [...direct].sort(),
    transitive,
    all: [...seen].sort(),
    details,
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
