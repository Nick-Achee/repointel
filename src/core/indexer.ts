import fg from "fast-glob";
import * as path from "node:path";
import type {
  FileInfo,
  SymbolInfo,
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
  getProjectIdentity,
  countPattern,
  filePathToRoutePath,
  writeJson,
  readJson,
} from "./utils.js";
import { scipSymbol, classifyExports, type PackageRef } from "./symbol-id.js";

const INDEX_VERSION = "1.3.0";

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
 * Packages whose presence in package.json is required before the corresponding
 * file patterns may claim a framework. Generic filenames like `server.ts` are
 * otherwise a false-positive machine.
 */
const FRAMEWORK_PACKAGES: Record<string, string[]> = {
  nextjs: ["next"],
  convex: ["convex"],
  remix: ["@remix-run/react", "@remix-run/node", "remix"],
  astro: ["astro"],
  vite: ["vite"],
  express: ["express"],
};

/**
 * Default patterns to ignore
 */
const TEST_IGNORE = [
  "**/*.test.{ts,tsx,js,jsx}",
  "**/*.spec.{ts,tsx,js,jsx}",
  "**/__tests__/**",
];

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  ...TEST_IGNORE,
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
  // CLI/tooling patterns — a command module is not an HTTP endpoint
  if (filePath.match(/\/bin\//i) || filePath.match(/\/cli\./i)) return "cli";
  if (filePath.match(/\/commands?\//i)) return "cli";
  // An MCP server is a request-serving surface, not a UI component
  if (filePath.match(/\/mcp\//i)) return "api";
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
  const source = stripComments(content);
  // Module-level import/export statements start a line; anchoring keeps
  // import statements that appear inside string literals out of the graph.
  const staticImports = source.matchAll(
    /^[ \t]*import\s+(?:[\w\s{},*$]+\s+from\s+)?['"]([^'"]+)['"]/gm
  );
  const dynamicImports = source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  const requires = source.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  const reExports = source.matchAll(
    /^[ \t]*export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/gm
  );

  for (const match of staticImports) imports.push(match[1]);
  for (const match of dynamicImports) imports.push(match[1]);
  for (const match of requires) imports.push(match[1]);
  for (const match of reExports) imports.push(match[1]);

  return [...new Set(imports)];
}

/**
 * Remove line and block comments so commented-out imports never become edges.
 * String literals are preserved because module specifiers live inside them.
 */
function stripComments(content: string): string {
  let out = "";
  let inString: string | null = null;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

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
      } else if (ch === "\n") {
        out += ch;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\" && next !== undefined) {
        out += next;
        i++;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
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

  return out;
}

/**
 * Extract which named bindings come from which module specifier.
 * `*` denotes a namespace import, `default` a default import.
 */
function extractImportBindings(content: string): Record<string, string[]> {
  const bindings: Record<string, string[]> = {};
  const add = (source: string, names: string[]) => {
    const list = bindings[source] || (bindings[source] = []);
    for (const name of names) if (name && !list.includes(name)) list.push(name);
  };

  const parseClause = (clause: string): string[] => {
    const names: string[] = [];
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
      for (const part of braced[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "").trim();
        if (name) names.push(name);
      }
    }
    const withoutBraces = clause.replace(/\{[^}]*\}/, "");
    if (/\*\s+as\s+\w+/.test(withoutBraces)) names.push("*");
    const defaultName = withoutBraces
      .replace(/\*\s+as\s+\w+/, "")
      .replace(/^\s*type\s+/, "")
      .split(",")[0]
      ?.trim();
    if (defaultName && /^\w+$/.test(defaultName)) names.push("default");
    return names;
  };

  const source = stripComments(content);

  // import <clause> from "source" — anchored to line start (see extractImports)
  for (const m of source.matchAll(
    /^[ \t]*import\s+([^'"]*?)\s+from\s+['"]([^'"]+)['"]/gm
  )) {
    add(m[2], parseClause(m[1]));
  }

  // export { a, b } from "source" / export * from "source"
  for (const m of source.matchAll(
    /^[ \t]*export\s+(?:type\s+)?(\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/gm
  )) {
    add(m[2], m[1].trim().startsWith("*") ? ["*"] : parseClause(m[1]));
  }

  return bindings;
}

/**
 * Line number (1-based) where each module specifier is imported.
 */
function extractImportLines(content: string): Record<string, number> {
  const source = stripComments(content);
  const lines: Record<string, number> = {};
  const lineOf = (index: number) =>
    source.slice(0, index).split("\n").length;

  const patterns = [
    /^[ \t]*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm,
    /^[ \t]*export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/gm,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      if (lines[m[1]] === undefined) lines[m[1]] = lineOf(m.index ?? 0);
    }
  }

  return lines;
}

/**
 * Map each exported symbol to the sibling exports its body references.
 * A wrapper that delegates to another export means consumers of the wrapper
 * are affected when the delegate changes.
 */
function extractSymbolRefs(
  content: string,
  exportNames: string[]
): Record<string, string[]> {
  const source = stripComments(content);
  const refs: Record<string, string[]> = {};
  if (exportNames.length === 0) return refs;

  // Split the file at top-level export declarations; each chunk is that
  // symbol's body (approximate but adequate at file granularity).
  const declRe =
    /^[ \t]*export\s+(?:async\s+)?(?:const|let|var|function|class)\s+(\w+)/gm;
  const marks: Array<{ name: string; start: number }> = [];
  for (const m of source.matchAll(declRe)) {
    marks.push({ name: m[1], start: m.index ?? 0 });
  }

  for (let i = 0; i < marks.length; i++) {
    const { name, start } = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1].start : source.length;
    const body = source.slice(start, end);
    const referenced = exportNames.filter(
      (other) =>
        other !== name && new RegExp(`\\b${other}\\b`).test(body)
    );
    if (referenced.length > 0) refs[name] = referenced;
  }

  return refs;
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
function analyzeFile(
  relativePath: string,
  repoRoot: string,
  pkg: PackageRef
): FileInfo | null {
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

  const fileExports = extractExports(content);
  const exportKinds = classifyExports(content);
  const symbols: SymbolInfo[] = fileExports
    .filter((name) => name !== "default")
    .map((name) => {
      const kind = exportKinds[name] ?? "term";
      return { name, kind, id: scipSymbol(pkg, relativePath, name, kind) };
    });

  return {
    path: absolutePath,
    relativePath,
    type,
    routePath,
    isClientComponent,
    isDynamicImport,
    imports: extractImports(content),
    importBindings: extractImportBindings(content),
    importLines: extractImportLines(content),
    exports: fileExports,
    symbols,
    symbolRefs: extractSymbolRefs(content, fileExports),
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
function readDeclaredDependencies(repoRoot: string): Set<string> {
  const content = readFileSafe(path.join(repoRoot, "package.json"));
  if (!content) return new Set();
  try {
    const pkg = JSON.parse(content);
    return new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ]);
  } catch {
    return new Set();
  }
}

async function detectFrameworks(repoRoot: string): Promise<DetectedFramework[]> {
  const frameworks: DetectedFramework[] = [];
  const declared = readDeclaredDependencies(repoRoot);
  const hasManifest = declared.size > 0;

  for (const [name, patterns] of Object.entries(FRAMEWORK_DETECTION)) {
    // A framework is only claimed when the project declares it as a dependency.
    const required = FRAMEWORK_PACKAGES[name] || [];
    if (hasManifest && required.length > 0 && !required.some((p) => declared.has(p))) {
      continue;
    }

    const matches = await fg(patterns, {
      cwd: repoRoot,
      ignore: DEFAULT_IGNORE,
      absolute: false,
    });
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
    const matches = await fg(patterns, {
      cwd: repoRoot,
      ignore: DEFAULT_IGNORE,
      absolute: false,
    });
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
  const baseIgnore = options.includeTests
    ? DEFAULT_IGNORE.filter((p) => !TEST_IGNORE.includes(p))
    : DEFAULT_IGNORE;
  const ignore = [...baseIgnore, ...(options.exclude || [])];

  const filePaths = await fg(patterns, {
    cwd: repoRoot,
    ignore,
    absolute: false,
  });

  // Count what was deliberately left out so callers never mistake the file
  // count for a repo total.
  const excludedTests = options.includeTests
    ? []
    : await fg(TEST_IGNORE, {
        cwd: repoRoot,
        ignore: DEFAULT_IGNORE.filter((p) => !TEST_IGNORE.includes(p)),
        absolute: false,
      });

  const identity = getProjectIdentity(repoRoot);
  const pkgRef: PackageRef = {
    name: identity.name || path.basename(repoRoot),
    version: identity.version,
  };

  const files: FileInfo[] = [];
  for (const filePath of filePaths) {
    const info = analyzeFile(filePath, repoRoot, pkgRef);
    if (info) files.push(info);
  }

  // Sort for determinism
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  // Detect frameworks and specs in parallel
  const [frameworks, specs] = await Promise.all([
    detectFrameworks(repoRoot),
    detectSpecs(repoRoot),
  ]);

  const declaredDeps = readDeclaredDependencies(repoRoot);
  const isReactProject =
    declaredDeps.size === 0 ||
    declaredDeps.has("react") ||
    declaredDeps.has("next") ||
    declaredDeps.has("preact");

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
    cli: 0,
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
    excludedFromIndex: {
      patterns: options.includeTests ? [] : TEST_IGNORE,
      tests: excludedTests.length,
    },
    provenance: {
      measured: [
        "files",
        "totalFiles",
        "totalSizeBytes",
        "imports",
        "exports",
        "excludedFromIndex",
      ],
      inferred: {
        byType:
          "path-pattern heuristic (directory and filename conventions), not semantic analysis",
        frameworks:
          "package.json dependency gate + file-pattern match; absence is not proof",
        routePath: "filename-to-route convention for the detected framework",
        ...(isReactProject
          ? {
              clientComponents: "'use client' directive scan",
              totalHooks: "regex count of hook call sites",
            }
          : {}),
      },
    },
    summary: {
      totalFiles: files.length,
      byType,
      // React-shaped metrics are meaningless noise on a non-React project.
      ...(isReactProject
        ? {
            clientComponents: files.filter((f) => f.isClientComponent).length,
            serverComponents: files.filter((f) => !f.isClientComponent).length,
            totalHooks: sumHooks(files),
            totalSideEffects: sumSideEffects(files),
            totalDataUsage: sumDataUsage(files),
            totalAntiPatterns: sumAntiPatterns(files),
          }
        : {}),
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
 * Check whether a cached index is stale relative to the working tree:
 * stale when the file set differs or any indexed file was modified after
 * the index was generated.
 */
export async function isIndexStale(
  index: RepoIndex,
  options: ScanOptions = {}
): Promise<boolean> {
  const repoRoot = options.root || process.cwd();
  const patterns = options.include?.length ? options.include : DEFAULT_PATTERNS;
  const baseIgnore = options.includeTests
    ? DEFAULT_IGNORE.filter((p) => !TEST_IGNORE.includes(p))
    : DEFAULT_IGNORE;
  const ignore = [...baseIgnore, ...(options.exclude || [])];

  // A cached index built with a different test policy cannot answer this request.
  const cachedIncludesTests = (index.excludedFromIndex?.patterns.length ?? 0) === 0;
  if (Boolean(options.includeTests) !== cachedIncludesTests) return true;

  // An index written by a different analyzer version may lack fields this
  // version reports (provenance, importBindings, …) — treat it as stale.
  if (index.version !== INDEX_VERSION) return true;

  const generatedAtMs = Date.parse(index.generatedAt);
  if (Number.isNaN(generatedAtMs)) return true;

  const entries = await fg(patterns, {
    cwd: repoRoot,
    ignore,
    absolute: false,
    stats: true,
  });

  if (entries.length !== index.files.length) return true;

  const indexed = new Set(index.files.map((f) => f.relativePath));
  for (const entry of entries) {
    if (!indexed.has(entry.path)) return true;
    if (entry.stats && entry.stats.mtimeMs > generatedAtMs) return true;
  }

  return false;
}

/**
 * Get or generate index. A cached index is only served when it is still
 * fresh; otherwise the repo is re-indexed and the cache updated.
 */
export async function getIndex(options: ScanOptions = {}): Promise<RepoIndex> {
  const repoRoot = options.root || process.cwd();

  if (!options.refresh) {
    const existing = loadIndex(repoRoot);
    if (existing && !(await isIndexStale(existing, options))) {
      return existing;
    }
    if (existing) {
      const fresh = await generateIndex(options);
      saveIndex(fresh, path.join(repoRoot, ".repointel"));
      return fresh;
    }
  }

  return generateIndex(options);
}
