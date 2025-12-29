import * as path from "node:path";
import * as fs from "node:fs";
import type {
  RouteGraph,
  RouteNode,
  RouteType,
  HttpMethod,
  GraphOptions,
} from "../types/index.js";
import {
  getGitCommit,
  readFileSafe,
  writeJson,
  readJson,
  filePathToRoutePath,
  extractRouteParams,
} from "./utils.js";
import { getIndex } from "./indexer.js";

const GRAPH_VERSION = "1.0.0";

/**
 * Determine route type from file path
 */
function getRouteType(relativePath: string): RouteType {
  if (relativePath.includes("/page.")) return "page";
  if (relativePath.includes("/route.")) return "api";
  if (relativePath.includes("/layout.")) return "layout";
  if (relativePath.includes("/loading.")) return "loading";
  if (relativePath.includes("/error.")) return "error";
  if (relativePath.includes("/not-found.")) return "not-found";
  return "page";
}

/**
 * Extract HTTP methods from API route file
 */
function extractHttpMethods(content: string): HttpMethod[] {
  const methods: HttpMethod[] = [];
  const allMethods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

  for (const method of allMethods) {
    // Match: export async function GET, export function POST, export const GET
    const pattern = new RegExp(`export\\s+(async\\s+)?(?:function|const)\\s+${method}\\b`);
    if (pattern.test(content)) {
      methods.push(method);
    }
  }

  return methods;
}

/**
 * Check if route path has dynamic segments
 */
function isDynamicRoute(routePath: string): boolean {
  return routePath.includes("[");
}

/**
 * Find parent layout for a route
 */
function findParentLayout(
  routePath: string,
  layoutMap: Map<string, string>
): string | undefined {
  const segments = routePath.split("/").filter(Boolean);

  // Walk up the path tree
  for (let i = segments.length - 1; i >= 0; i--) {
    const parentPath = "/" + segments.slice(0, i).join("/");
    const layoutId = layoutMap.get(parentPath || "/");
    if (layoutId) {
      return layoutId;
    }
  }

  // Check root layout
  return layoutMap.get("/");
}

/**
 * Detect framework from repo structure
 */
function detectFramework(
  repoRoot: string
): "nextjs-app" | "nextjs-pages" | "remix" | "unknown" {
  // Check for app directory
  if (
    fs.existsSync(path.join(repoRoot, "app")) ||
    fs.existsSync(path.join(repoRoot, "src/app"))
  ) {
    return "nextjs-app";
  }

  // Check for pages directory
  if (
    fs.existsSync(path.join(repoRoot, "pages")) ||
    fs.existsSync(path.join(repoRoot, "src/pages"))
  ) {
    return "nextjs-pages";
  }

  // Check for Remix
  if (fs.existsSync(path.join(repoRoot, "app/routes"))) {
    return "remix";
  }

  return "unknown";
}

/**
 * Find middleware files that apply to routes
 */
function findMiddleware(repoRoot: string): RouteGraph["middleware"] {
  const middleware: RouteGraph["middleware"] = [];
  const possiblePaths = [
    "middleware.ts",
    "middleware.js",
    "src/middleware.ts",
    "src/middleware.js",
  ];

  for (const p of possiblePaths) {
    const fullPath = path.join(repoRoot, p);
    if (fs.existsSync(fullPath)) {
      const content = readFileSafe(fullPath) || "";

      // Extract matcher config
      const matcherMatch = content.match(/matcher\s*:\s*(\[[\s\S]*?\]|['"][^'"]+['"])/);
      let matchers: string[] | undefined;

      if (matcherMatch) {
        try {
          // Simple extraction - won't handle all cases but covers common ones
          const matcherStr = matcherMatch[1];
          if (matcherStr.startsWith("[")) {
            matchers = matcherStr
              .slice(1, -1)
              .split(",")
              .map((m) => m.trim().replace(/['"]/g, ""))
              .filter(Boolean);
          } else {
            matchers = [matcherStr.replace(/['"]/g, "")];
          }
        } catch {
          // Ignore parse errors
        }
      }

      middleware.push({
        file: p,
        matcher: matchers,
      });
    }
  }

  return middleware;
}

/**
 * Build route graph from repo index
 */
export async function buildRouteGraph(options: GraphOptions = {}): Promise<RouteGraph> {
  const repoRoot = options.root || process.cwd();
  const index = await getIndex({ root: repoRoot });
  const framework = detectFramework(repoRoot);

  const routes: RouteNode[] = [];
  const layouts: RouteNode[] = [];
  const layoutMap = new Map<string, string>(); // routePath -> layout id

  // First pass: collect layouts
  for (const file of index.files) {
    if (file.type === "layout" && file.routePath) {
      const content = readFileSafe(file.path) || "";

      const layoutNode: RouteNode = {
        id: file.routePath,
        routePath: file.routePath,
        file: file.relativePath,
        type: "layout",
        isClientComponent: file.isClientComponent,
        isDynamic: isDynamicRoute(file.routePath),
        params: extractRouteParams(file.routePath),
      };

      layouts.push(layoutNode);
      layoutMap.set(file.routePath, file.routePath);
    }
  }

  // Second pass: collect routes with parent layouts
  for (const file of index.files) {
    if (!file.routePath) continue;

    const routeType = getRouteType(file.relativePath);
    if (routeType === "layout") continue; // Already processed

    const content = readFileSafe(file.path) || "";
    const parentLayout = findParentLayout(file.routePath, layoutMap);

    const routeNode: RouteNode = {
      id: file.routePath + (routeType === "api" ? ":api" : ""),
      routePath: file.routePath,
      file: file.relativePath,
      type: routeType,
      isClientComponent: file.isClientComponent,
      isDynamic: isDynamicRoute(file.routePath),
      params: extractRouteParams(file.routePath),
      parentLayout,
    };

    // Extract HTTP methods for API routes
    if (routeType === "api") {
      routeNode.methods = extractHttpMethods(content);
    }

    routes.push(routeNode);
  }

  // Find middleware
  const middleware = findMiddleware(repoRoot);

  // Apply middleware to routes
  for (const mw of middleware) {
    if (!mw.matcher) continue;

    for (const route of routes) {
      for (const pattern of mw.matcher) {
        // Simple pattern matching
        if (
          route.routePath.startsWith(pattern.replace("/:path*", "").replace("/(.*)", ""))
        ) {
          if (!route.middleware) route.middleware = [];
          if (!route.middleware.includes(mw.file)) {
            route.middleware.push(mw.file);
          }
        }
      }
    }
  }

  // Calculate stats
  const stats = {
    totalRoutes: routes.filter((r) => r.type === "page").length,
    totalLayouts: layouts.length,
    dynamicRoutes: routes.filter((r) => r.isDynamic).length,
    apiRoutes: routes.filter((r) => r.type === "api").length,
    clientPages: routes.filter((r) => r.type === "page" && r.isClientComponent).length,
    serverPages: routes.filter((r) => r.type === "page" && !r.isClientComponent).length,
  };

  return {
    version: GRAPH_VERSION,
    generatedAt: new Date().toISOString(),
    gitCommit: getGitCommit(repoRoot),
    repoRoot,
    framework,
    routes,
    layouts,
    middleware,
    stats,
  };
}

/**
 * Save route graph to disk
 */
export function saveRouteGraph(graph: RouteGraph, outputPath?: string): string {
  const filePath =
    outputPath || path.join(graph.repoRoot, ".repointel", "graphs", "routes.json");
  writeJson(filePath, graph);
  return filePath;
}

/**
 * Load route graph from disk
 */
export function loadRouteGraph(repoRoot: string): RouteGraph | null {
  const filePath = path.join(repoRoot, ".repointel", "graphs", "routes.json");
  return readJson<RouteGraph>(filePath);
}

/**
 * Generate Mermaid diagram from route graph
 */
export function routeGraphToMermaid(
  graph: RouteGraph,
  options: { direction?: "TD" | "LR" } = {}
): string {
  const direction = options.direction || "TD";
  const lines: string[] = [`graph ${direction}`];

  // Group routes by parent layout
  const routesByLayout = new Map<string, RouteNode[]>();

  for (const route of graph.routes) {
    const layoutId = route.parentLayout || "root";
    if (!routesByLayout.has(layoutId)) {
      routesByLayout.set(layoutId, []);
    }
    routesByLayout.get(layoutId)!.push(route);
  }

  // Add layouts as subgraphs
  for (const layout of graph.layouts) {
    const id = sanitizeId(layout.id);
    const label = layout.routePath === "/" ? "Root Layout" : layout.routePath;
    lines.push(`  subgraph ${id}["${label}"]`);

    const childRoutes = routesByLayout.get(layout.routePath) || [];
    for (const route of childRoutes) {
      const routeId = sanitizeId(route.id);
      const routeLabel = route.routePath;
      const shape =
        route.type === "api" ? `{{"${routeLabel}"}}`  : `["${routeLabel}"]`;
      lines.push(`    ${routeId}${shape}`);
    }

    lines.push("  end");
  }

  // Add routes without layouts
  const orphanRoutes = routesByLayout.get("root") || [];
  for (const route of orphanRoutes) {
    const routeId = sanitizeId(route.id);
    const shape = route.type === "api" ? `{{"${route.routePath}"}}` : `["${route.routePath}"]`;
    lines.push(`  ${routeId}${shape}`);
  }

  // Add layout hierarchy edges
  for (const layout of graph.layouts) {
    if (layout.parentLayout) {
      const fromId = sanitizeId(layout.parentLayout);
      const toId = sanitizeId(layout.id);
      lines.push(`  ${fromId} --> ${toId}`);
    }
  }

  // Add styles
  lines.push("");
  lines.push("  classDef page fill:#e1f5fe,stroke:#01579b");
  lines.push("  classDef api fill:#fff3e0,stroke:#e65100");
  lines.push("  classDef layout fill:#f3e5f5,stroke:#4a148c");

  // Apply styles
  for (const route of graph.routes) {
    const id = sanitizeId(route.id);
    lines.push(`  class ${id} ${route.type}`);
  }

  return lines.join("\n");
}

/**
 * Sanitize ID for Mermaid
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}
