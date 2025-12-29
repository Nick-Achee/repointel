import * as path from "node:path";
import * as fs from "node:fs";
import fg from "fast-glob";
import type {
  ApiGraph,
  ApiEndpoint,
  ApiType,
  HttpMethod,
  GraphOptions,
} from "../types/index.js";
import { getGitCommit, readFileSafe, writeJson, readJson } from "./utils.js";

const GRAPH_VERSION = "1.0.0";

/**
 * Extract Convex function definitions from a file
 */
function extractConvexFunctions(
  content: string,
  relativePath: string
): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const fileName = path.basename(relativePath, ".ts");

  // Match: export const funcName = query({ ... })
  // Match: export const funcName = mutation({ ... })
  // Match: export const funcName = action({ ... })
  // Match: export const funcName = internalQuery({ ... })
  // Match: export const funcName = internalMutation({ ... })
  // Match: export const funcName = internalAction({ ... })
  const funcPattern =
    /export\s+const\s+(\w+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\s*\(/g;

  let match;
  while ((match = funcPattern.exec(content)) !== null) {
    const [, funcName, funcType] = match;

    const isInternal = funcType.startsWith("internal");
    const baseType = funcType.replace("internal", "").toLowerCase();

    // Build the API path (e.g., api.users.getUser)
    const apiPath = `api.${fileName}.${funcName}`;

    endpoints.push({
      id: apiPath,
      name: funcName,
      type: "convex",
      path: apiPath,
      file: relativePath,
      isPublic: !isInternal,
      auth: extractAuthRequirement(content, funcName),
    });
  }

  return endpoints;
}

/**
 * Try to extract auth requirement from Convex function
 */
function extractAuthRequirement(content: string, funcName: string): string | undefined {
  // Look for patterns like: ctx.auth.getUserIdentity() or getAuthUserId(ctx)
  // This is a heuristic - not perfect but catches common patterns

  // Find the function definition block
  const funcPattern = new RegExp(
    `export\\s+const\\s+${funcName}\\s*=\\s*(?:query|mutation|action|internalQuery|internalMutation|internalAction)\\s*\\(\\{[^}]*handler:\\s*async\\s*\\([^)]*\\)\\s*=>\\s*\\{([^]*?)(?=export\\s+const|$)`,
    "m"
  );

  const match = content.match(funcPattern);
  if (!match) return undefined;

  const body = match[1];

  if (body.includes("getUserIdentity") || body.includes("getAuthUserId")) {
    return "authenticated";
  }

  return undefined;
}

/**
 * Extract REST API route handlers (Next.js API routes)
 */
function extractRestHandlers(
  content: string,
  relativePath: string
): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  // Extract route path from file path
  let routePath = relativePath
    .replace(/^src\/app/, "")
    .replace(/^app/, "")
    .replace(/\/route\.(ts|js)$/, "")
    .replace(/\(([^)]+)\)\//g, "");

  if (!routePath.startsWith("/")) {
    routePath = "/" + routePath;
  }

  // Find exported HTTP methods
  const methods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

  for (const method of methods) {
    const pattern = new RegExp(
      `export\\s+(async\\s+)?(?:function|const)\\s+${method}\\b`
    );
    if (pattern.test(content)) {
      endpoints.push({
        id: `${method}:${routePath}`,
        name: `${method} ${routePath}`,
        type: "rest",
        method,
        path: routePath,
        file: relativePath,
        isPublic: true, // REST routes are public by default
      });
    }
  }

  return endpoints;
}

/**
 * Build API graph from repo
 */
export async function buildApiGraph(options: GraphOptions = {}): Promise<ApiGraph> {
  const repoRoot = options.root || process.cwd();
  const endpoints: ApiEndpoint[] = [];
  const routers: ApiGraph["routers"] = [];

  // Find Convex files
  const convexFiles = await fg("convex/**/*.ts", {
    cwd: repoRoot,
    ignore: ["**/convex/_generated/**", "**/*.test.ts"],
    absolute: false,
  });

  // Process Convex files
  for (const file of convexFiles) {
    const absolutePath = path.join(repoRoot, file);
    const content = readFileSafe(absolutePath);
    if (!content) continue;

    const convexEndpoints = extractConvexFunctions(content, file);
    if (convexEndpoints.length > 0) {
      endpoints.push(...convexEndpoints);

      // Add as router
      routers.push({
        name: path.basename(file, ".ts"),
        file,
        endpoints: convexEndpoints.map((e) => e.id),
      });
    }
  }

  // Find Next.js API routes
  const apiRoutePatterns = [
    "src/app/**/route.ts",
    "src/app/**/route.js",
    "app/**/route.ts",
    "app/**/route.js",
    "pages/api/**/*.ts",
    "pages/api/**/*.js",
    "src/pages/api/**/*.ts",
    "src/pages/api/**/*.js",
  ];

  const apiRoutes = await fg(apiRoutePatterns, {
    cwd: repoRoot,
    absolute: false,
  });

  // Process API routes
  for (const file of apiRoutes) {
    const absolutePath = path.join(repoRoot, file);
    const content = readFileSafe(absolutePath);
    if (!content) continue;

    const restEndpoints = extractRestHandlers(content, file);
    endpoints.push(...restEndpoints);
  }

  // Calculate stats
  const byType: Record<ApiType, number> = {
    convex: 0,
    rest: 0,
    trpc: 0,
    graphql: 0,
  };

  let publicEndpoints = 0;
  let protectedEndpoints = 0;

  for (const endpoint of endpoints) {
    byType[endpoint.type]++;
    if (endpoint.isPublic) {
      publicEndpoints++;
    } else {
      protectedEndpoints++;
    }
  }

  return {
    version: GRAPH_VERSION,
    generatedAt: new Date().toISOString(),
    gitCommit: getGitCommit(repoRoot),
    repoRoot,
    endpoints,
    routers,
    stats: {
      totalEndpoints: endpoints.length,
      byType,
      publicEndpoints,
      protectedEndpoints,
    },
  };
}

/**
 * Save API graph to disk
 */
export function saveApiGraph(graph: ApiGraph, outputPath?: string): string {
  const filePath =
    outputPath || path.join(graph.repoRoot, ".repointel", "graphs", "api.json");
  writeJson(filePath, graph);
  return filePath;
}

/**
 * Load API graph from disk
 */
export function loadApiGraph(repoRoot: string): ApiGraph | null {
  const filePath = path.join(repoRoot, ".repointel", "graphs", "api.json");
  return readJson<ApiGraph>(filePath);
}

/**
 * Generate Mermaid diagram from API graph
 */
export function apiGraphToMermaid(graph: ApiGraph): string {
  const lines: string[] = ["graph LR"];

  // Group by router/file
  const byRouter = new Map<string, ApiEndpoint[]>();

  for (const endpoint of graph.endpoints) {
    const router = path.basename(endpoint.file, ".ts");
    if (!byRouter.has(router)) {
      byRouter.set(router, []);
    }
    byRouter.get(router)!.push(endpoint);
  }

  // Add subgraphs for each router
  for (const [router, endpoints] of byRouter) {
    const routerId = sanitizeId(router);
    lines.push(`  subgraph ${routerId}["${router}"]`);

    for (const endpoint of endpoints) {
      const id = sanitizeId(endpoint.id);
      const label = endpoint.name;
      const shape = endpoint.isPublic ? `["${label}"]` : `(["${label}"])`;
      lines.push(`    ${id}${shape}`);
    }

    lines.push("  end");
  }

  // Add styles
  lines.push("");
  lines.push("  classDef public fill:#e8f5e9,stroke:#1b5e20");
  lines.push("  classDef protected fill:#fff3e0,stroke:#e65100");

  // Apply styles
  for (const endpoint of graph.endpoints) {
    const id = sanitizeId(endpoint.id);
    const cls = endpoint.isPublic ? "public" : "protected";
    lines.push(`  class ${id} ${cls}`);
  }

  return lines.join("\n");
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}
