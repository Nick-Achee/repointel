import fg from "fast-glob";
import * as path from "node:path";
import type {
  FileInfo,
  FileType,
  RepoIndex,
  HookCounts,
  SideEffectCounts,
  DataCounts,
  AntiPatternCounts,
  ScanOptions,
  DetectedFramework,
  DetectedSpec,
  Framework,
  SpecType,
} from "../types/index.js";
import {
  readFileSafe,
  getFileSize,
  hashFile,
  getGitCommit,
  getGitBranch,
  countPattern,
  filePathToRoutePath,
  writeJson,
  readJson,
} from "./utils.js";

const INDEX_VERSION = "1.0.0";

/**
 * Default file patterns to scan
 * Universal patterns that work for any TypeScript/JavaScript project
 */
const DEFAULT_PATTERNS = [
  // Universal: scan ALL JS/TS files anywhere in the project
  "**/*.{ts,tsx,js,jsx,mjs,cjs}",
];

/**
 * Spec/contract file patterns to detect
 */
const SPEC_PATTERNS = {
  speckit: [".specify/**/*", ".specify/specs/**/*.md"],
  openapi: ["**/openapi.{yaml,yml,json}", "**/swagger.{yaml,yml,json}"],
  typespec: ["**/*.tsp"],
  graphql: ["**/*.graphql", "**/schema.graphql"],
};

/**
 * Framework detection patterns
 */
const FRAMEWORK_DETECTION = {
  nextjs: ["next.config.{js,mjs,ts}", "app/**/page.tsx", "pages/**/*.tsx"],
  convex: ["convex/_generated/**", "convex.json"],
  remix: ["remix.config.{js,ts}", "app/root.tsx"],
  astro: ["astro.config.{mjs,ts}"],
  vite: ["vite.config.{js,ts}"],
  express: ["**/app.{js,ts}", "**/server.{js,ts}"],
};

/**
 * Default patterns to ignore
 */
const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/*.test.{ts,tsx,js,jsx}",
  "**/*.spec.{ts,tsx,js,jsx}",
  "**/__tests__/**",
  "**/convex/_generated/**",
  "**/*.d.ts",
];

/**
 * Determine file type from path
 */
function inferFileType(filePath: string): FileType {
  // Convex schema
  if (filePath.startsWith("convex/")) return "schema";
  // Next.js special files
  if (filePath.includes("/page.")) return "page";
  if (filePath.includes("/layout.")) return "layout";
  if (filePath.includes("/loading.")) return "loading";
  if (filePath.includes("/error.")) return "error";
  if (filePath.includes("/not-found.")) return "error";
  if (filePath.includes("/route.")) return "route";
  if (filePath.includes("middleware.")) return "middleware";
  // CLI/tooling patterns
  if (filePath.match(/\/bin\//i) || filePath.match(/\/cli\./i)) return "api";
  if (filePath.match(/\/commands?\//i)) return "api";
  if (filePath.match(/\/generators?\//i)) return "lib";
  if (filePath.match(/\/validators?\//i)) return "lib";
  if (filePath.match(/\/core\//i)) return "lib";
  // Common patterns
  if (filePath.match(/\/hooks?\//i) || filePath.match(/\/use[A-Z]/)) return "hook";
  if (filePath.match(/\/lib\//i) || filePath.match(/\/utils?\//i)) return "lib";
  if (filePath.match(/\/types?\//i)) return "type";
  if (filePath.match(/\/server\//i) || filePath.match(/\/api\//i)) return "api";
  if (filePath.match(/\.config\./)) return "config";
  // Index files are often entry points
  if (filePath.match(/\/index\.[jt]sx?$/)) return "lib";
  return "component";
}

/**
 * Extract imports from file content
 */
function extractImports(content: string): string[] {
  const imports: string[] = [];
  const staticImports = content.matchAll(
    /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"]+)['"]/g
  );
  const dynamicImports = content.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  const requires = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);

  for (const match of staticImports) imports.push(match[1]);
  for (const match of dynamicImports) imports.push(match[1]);
  for (const match of requires) imports.push(match[1]);

  return [...new Set(imports)];
}

/**
 * Extract exports from file content
 */
function extractExports(content: string): string[] {
  const exports: string[] = [];

  // Named exports
  const namedExports = content.matchAll(
    /export\s+(?:const|let|var|function|class|type|interface)\s+(\w+)/g
  );
  for (const match of namedExports) exports.push(match[1]);

  // Export { ... }
  const bracketExports = content.matchAll(/export\s*\{([^}]+)\}/g);
  for (const match of bracketExports) {
    const names = match[1].split(",").map((n) => n.trim().split(" ")[0]);
    exports.push(...names);
  }

  // Default export
  if (/export\s+default/.test(content)) {
    exports.push("default");
  }

  return [...new Set(exports.filter(Boolean))];
}

/**
 * Count React hooks usage
 */
function countHooks(content: string): HookCounts {
  return {
    useState: countPattern(content, /\buseState\s*[<(]/g),
    useReducer: countPattern(content, /\buseReducer\s*[<(]/g),
    useEffect: countPattern(content, /\buseEffect\s*\(/g),
    useLayoutEffect: countPattern(content, /\buseLayoutEffect\s*\(/g),
    useMemo: countPattern(content, /\buseMemo\s*[<(]/g),
    useCallback: countPattern(content, /\buseCallback\s*[<(]/g),
    useRef: countPattern(content, /\buseRef\s*[<(]/g),
    useContext: countPattern(content, /\buseContext\s*[<(]/g),
  };
}

/**
 * Count side effects
 */
function countSideEffects(content: string): SideEffectCounts {
  return {
    addEventListener: countPattern(content, /\.addEventListener\s*\(/g),
    removeEventListener: countPattern(content, /\.removeEventListener\s*\(/g),
    IntersectionObserver: countPattern(content, /new\s+IntersectionObserver\s*\(/g),
    ResizeObserver: countPattern(content, /new\s+ResizeObserver\s*\(/g),
    MutationObserver: countPattern(content, /new\s+MutationObserver\s*\(/g),
    requestAnimationFrame: countPattern(content, /\brequestAnimationFrame\s*\(/g),
    setInterval: countPattern(content, /\bsetInterval\s*\(/g),
    setTimeout: countPattern(content, /\bsetTimeout\s*\(/g),
  };
}

/**
 * Count data fetching patterns
 */
function countDataUsage(content: string): DataCounts {
  return {
    useQuery: countPattern(content, /\buseQuery\s*\(/g),
    useMutation: countPattern(content, /\buseMutation\s*\(/g),
    useAction: countPattern(content, /\buseAction\s*\(/g),
    fetch: countPattern(content, /\bfetch\s*\(/g),
  };
}

/**
 * Detect anti-patterns in code
 * These are heuristic-based signals for potential issues
 */
function detectAntiPatterns(content: string): AntiPatternCounts {
  // Conditional hooks: React hooks called inside if/switch/ternary expressions
  // This detects violations of the Rules of Hooks
  // Note: Limit to ~200 chars to avoid false positives from spanning statements
  const conditionalHooks = countPattern(
    content,
    /(?:if\s*\([^)]*\)\s*\{[^}]{0,200}|switch\s*\([^)]*\)\s*\{[^}]{0,200}|\?\s*)\buse[A-Z]\w*\s*\(/g
  );

  // Hooks in loops: useXxx inside for/while/map/forEach
  // Note: Limit to ~200 chars to avoid false positives
  const hooksInLoops = countPattern(
    content,
    /(?:for\s*\([^)]*\)\s*\{[^}]{0,200}|while\s*\([^)]*\)\s*\{[^}]{0,200}|\.(?:map|forEach|filter|reduce)\s*\([^)]*=>[^}]{0,200})\buse[A-Z]\w*\s*\(/g
  );

  // Missing deps: useEffect with empty [] but references variables
  // Heuristic: useEffect(() => { ... someVar ... }, [])
  const emptyDepsEffects = content.match(/useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]+\}\s*,\s*\[\s*\]\s*\)/g) || [];
  let missingDeps = 0;
  for (const effect of emptyDepsEffects) {
    // Check if effect body references common state patterns
    if (/\b(?:state|props|data|value|count|user|items)\b/.test(effect)) {
      missingDeps++;
    }
  }

  // Missing cleanup: useEffect with addEventListener/subscribe but no return
  const effectsWithSubscription = content.match(
    /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*(?:addEventListener|subscribe|setInterval|setTimeout)[^}]*\}/g
  ) || [];
  let missingCleanup = 0;
  for (const effect of effectsWithSubscription) {
    if (!/return\s*(?:\(\s*\)\s*=>|\(\s*function|\(\s*\{)/.test(effect)) {
      missingCleanup++;
    }
  }

  // Async state update: await followed by setState without isMounted check
  const asyncStateUpdate = countPattern(
    content,
    /await\s+[^;]+;\s*(?:set[A-Z]\w*|setState)\s*\(/g
  );

  // Unbounded fetch: fetch without AbortController in useEffect
  const effectsWithFetch = content.match(/useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*fetch\s*\([^}]*\}/g) || [];
  let unboundedFetch = 0;
  for (const effect of effectsWithFetch) {
    if (!/AbortController/.test(effect)) {
      unboundedFetch++;
    }
  }

  return {
    conditionalHooks,
    hooksInLoops,
    missingDeps,
    missingCleanup,
    asyncStateUpdate,
    unboundedFetch,
  };
}

/**
 * Analyze a single file
 */
function analyzeFile(relativePath: string, repoRoot: string): FileInfo | null {
  const absolutePath = path.join(repoRoot, relativePath);
  const content = readFileSafe(absolutePath);
  if (!content) return null;

  const sizeBytes = getFileSize(absolutePath);
  const type = inferFileType(relativePath);
  const routePath =
    type === "page" || type === "layout" || type === "route" || type === "loading" || type === "error"
      ? filePathToRoutePath(relativePath)
      : undefined;

  // Check for "use client" directive
  const isClientComponent = /^['"]use client['"];?/m.test(content);

  // Check for dynamic imports with ssr: false
  const isDynamicImport = /dynamic\s*\([^)]*\{\s*ssr\s*:\s*false/.test(
    content.replace(/\n/g, " ")
  );

  return {
    path: absolutePath,
    relativePath,
    type,
    routePath,
    isClientComponent,
    isDynamicImport,
    imports: extractImports(content),
    exports: extractExports(content),
    hooks: countHooks(content),
    sideEffects: countSideEffects(content),
    data: countDataUsage(content),
    antiPatterns: detectAntiPatterns(content),
    sizeBytes,
    hash: hashFile(content),
  };
}

/**
 * Sum hook counts
 */
function sumHooks(files: FileInfo[]): HookCounts {
  const sum: HookCounts = {
    useState: 0,
    useReducer: 0,
    useEffect: 0,
    useLayoutEffect: 0,
    useMemo: 0,
    useCallback: 0,
    useRef: 0,
    useContext: 0,
  };
  for (const file of files) {
    for (const key of Object.keys(sum) as (keyof HookCounts)[]) {
      sum[key] += file.hooks[key];
    }
  }
  return sum;
}

/**
 * Sum side effect counts
 */
function sumSideEffects(files: FileInfo[]): SideEffectCounts {
  const sum: SideEffectCounts = {
    addEventListener: 0,
    removeEventListener: 0,
    IntersectionObserver: 0,
    ResizeObserver: 0,
    MutationObserver: 0,
    requestAnimationFrame: 0,
    setInterval: 0,
    setTimeout: 0,
  };
  for (const file of files) {
    for (const key of Object.keys(sum) as (keyof SideEffectCounts)[]) {
      sum[key] += file.sideEffects[key];
    }
  }
  return sum;
}

/**
 * Sum data usage counts
 */
function sumDataUsage(files: FileInfo[]): DataCounts {
  const sum: DataCounts = {
    useQuery: 0,
    useMutation: 0,
    useAction: 0,
    fetch: 0,
  };
  for (const file of files) {
    for (const key of Object.keys(sum) as (keyof DataCounts)[]) {
      sum[key] += file.data[key];
    }
  }
  return sum;
}

/**
 * Sum anti-pattern counts
 */
function sumAntiPatterns(files: FileInfo[]): AntiPatternCounts {
  const sum: AntiPatternCounts = {
    conditionalHooks: 0,
    hooksInLoops: 0,
    missingDeps: 0,
    missingCleanup: 0,
    asyncStateUpdate: 0,
    unboundedFetch: 0,
  };
  for (const file of files) {
    for (const key of Object.keys(sum) as (keyof AntiPatternCounts)[]) {
      sum[key] += file.antiPatterns[key];
    }
  }
  return sum;
}

/**
 * Detect frameworks in the repository
 */
async function detectFrameworks(repoRoot: string): Promise<DetectedFramework[]> {
  const frameworks: DetectedFramework[] = [];

  for (const [name, patterns] of Object.entries(FRAMEWORK_DETECTION)) {
    const matches = await fg(patterns, { cwd: repoRoot, absolute: false });
    if (matches.length > 0) {
      const configFile = matches.find((m) =>
        m.includes("config") || m.endsWith(".json")
      );
      frameworks.push({
        name: name as Framework,
        configFile,
      });
    }
  }

  return frameworks;
}

/**
 * Detect spec/contract files in the repository
 */
async function detectSpecs(repoRoot: string): Promise<DetectedSpec[]> {
  const specs: DetectedSpec[] = [];

  for (const [type, patterns] of Object.entries(SPEC_PATTERNS)) {
    const matches = await fg(patterns, { cwd: repoRoot, absolute: false });
    if (matches.length > 0) {
      specs.push({
        type: type as SpecType,
        files: matches,
      });
    }
  }

  return specs;
}

/**
 * Generate repo index
 */
export async function generateIndex(options: ScanOptions = {}): Promise<RepoIndex> {
  const repoRoot = options.root || process.cwd();
  const patterns = options.include?.length ? options.include : DEFAULT_PATTERNS;
  const ignore = [...DEFAULT_IGNORE, ...(options.exclude || [])];

  const filePaths = await fg(patterns, {
    cwd: repoRoot,
    ignore,
    absolute: false,
  });

  const files: FileInfo[] = [];
  for (const filePath of filePaths) {
    const info = analyzeFile(filePath, repoRoot);
    if (info) files.push(info);
  }

  // Sort for determinism
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  // Detect frameworks and specs in parallel
  const [frameworks, specs] = await Promise.all([
    detectFrameworks(repoRoot),
    detectSpecs(repoRoot),
  ]);

  // Build type counts
  const byType: Record<FileType, number> = {
    page: 0,
    layout: 0,
    loading: 0,
    error: 0,
    route: 0,
    middleware: 0,
    component: 0,
    lib: 0,
    hook: 0,
    type: 0,
    config: 0,
    api: 0,
    schema: 0,
    unknown: 0,
  };
  for (const file of files) {
    byType[file.type]++;
  }

  return {
    version: INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    gitCommit: getGitCommit(repoRoot),
    gitBranch: getGitBranch(repoRoot),
    repoRoot,
    files,
    frameworks,
    specs,
    summary: {
      totalFiles: files.length,
      byType,
      clientComponents: files.filter((f) => f.isClientComponent).length,
      serverComponents: files.filter((f) => !f.isClientComponent).length,
      totalHooks: sumHooks(files),
      totalSideEffects: sumSideEffects(files),
      totalDataUsage: sumDataUsage(files),
      totalAntiPatterns: sumAntiPatterns(files),
      totalSizeBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
    },
  };
}

/**
 * Save index to disk
 */
export function saveIndex(index: RepoIndex, outputDir?: string): string {
  const dir = outputDir || path.join(index.repoRoot, ".repointel");
  const filePath = path.join(dir, "index.json");
  writeJson(filePath, index);
  return filePath;
}

/**
 * Load index from disk
 */
export function loadIndex(repoRoot: string): RepoIndex | null {
  const filePath = path.join(repoRoot, ".repointel", "index.json");
  return readJson<RepoIndex>(filePath);
}

/**
 * Get or generate index
 */
export async function getIndex(options: ScanOptions = {}): Promise<RepoIndex> {
  const repoRoot = options.root || process.cwd();

  if (!options.refresh) {
    const existing = loadIndex(repoRoot);
    if (existing) return existing;
  }

  return generateIndex(options);
}
