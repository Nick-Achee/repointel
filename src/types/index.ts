/**
 * Core type definitions for repointel
 * All graph outputs conform to these schemas
 */

// =============================================================================
// File Analysis Types
// =============================================================================

export interface HookCounts {
  useState: number;
  useReducer: number;
  useEffect: number;
  useLayoutEffect: number;
  useMemo: number;
  useCallback: number;
  useRef: number;
  useContext: number;
}

export interface SideEffectCounts {
  addEventListener: number;
  removeEventListener: number;
  IntersectionObserver: number;
  ResizeObserver: number;
  MutationObserver: number;
  requestAnimationFrame: number;
  setInterval: number;
  setTimeout: number;
}

export interface DataCounts {
  useQuery: number;
  useMutation: number;
  useAction: number;
  fetch: number;
}

/**
 * Anti-pattern detection counts
 * These are heuristic-based signals, not definitive bugs
 */
export interface AntiPatternCounts {
  /** Hooks called inside if/switch/ternary */
  conditionalHooks: number;
  /** Hooks called inside for/while/map/forEach */
  hooksInLoops: number;
  /** useEffect with empty deps but references state/props */
  missingDeps: number;
  /** useEffect with subscriptions but no cleanup return */
  missingCleanup: number;
  /** setState called after await without isMounted check */
  asyncStateUpdate: number;
  /** fetch/promise without AbortController */
  unboundedFetch: number;
}

export type FileType =
  | "page"
  | "layout"
  | "loading"
  | "error"
  | "route"
  | "middleware"
  | "component"
  | "lib"
  | "hook"
  | "type"
  | "config"
  | "api"       // tRPC/REST handlers
  | "schema"    // DB schema files
  | "unknown";

export interface FileInfo {
  path: string;
  relativePath: string;
  type: FileType;
  routePath?: string;
  isClientComponent: boolean;
  isDynamicImport: boolean;
  imports: string[];
  exports: string[];
  hooks: HookCounts;
  sideEffects: SideEffectCounts;
  data: DataCounts;
  antiPatterns: AntiPatternCounts;
  sizeBytes: number;
  hash: string;
}

// =============================================================================
// Framework & Spec Detection
// =============================================================================

export type Framework =
  | "nextjs"
  | "remix"
  | "astro"
  | "vite"
  | "express"
  | "convex"
  | "unknown";

export type SpecType =
  | "speckit"
  | "openapi"
  | "typespec"
  | "graphql";

export interface DetectedSpec {
  type: SpecType;
  files: string[];
}

export interface DetectedFramework {
  name: Framework;
  configFile?: string;
  version?: string;
}

// =============================================================================
// Repo Index (repo-scan output)
// =============================================================================

export interface RepoIndex {
  version: string;
  generatedAt: string;
  gitCommit?: string;
  gitBranch?: string;
  repoRoot: string;
  files: FileInfo[];
  frameworks: DetectedFramework[];
  specs: DetectedSpec[];
  summary: {
    totalFiles: number;
    byType: Record<FileType, number>;
    clientComponents: number;
    serverComponents: number;
    totalHooks: HookCounts;
    totalSideEffects: SideEffectCounts;
    totalDataUsage: DataCounts;
    totalAntiPatterns: AntiPatternCounts;
    totalSizeBytes: number;
  };
}

// =============================================================================
// Dependency Graph (dep-graph output)
// =============================================================================

export interface DepNode {
  id: string;              // relativePath as ID
  path: string;
  type: FileType;
  isExternal: boolean;
  isCircular?: boolean;
  depth?: number;          // depth from seed file
}

export interface DepEdge {
  from: string;            // source file relativePath
  to: string;              // target file relativePath
  type: "static" | "dynamic" | "type-only";
  symbol?: string;         // specific export imported
}

export interface DepGraph {
  version: string;
  generatedAt: string;
  gitCommit?: string;
  repoRoot: string;
  nodes: DepNode[];
  edges: DepEdge[];
  cycles: string[][];      // arrays of file paths in cycle
  stats: {
    totalNodes: number;
    totalEdges: number;
    externalDeps: number;
    circularDeps: number;
    avgDepsPerFile: number;
    maxDeps: { file: string; count: number };
  };
}

// =============================================================================
// Route Graph (route-graph output) - Next.js specific
// =============================================================================

export type RouteType = "page" | "api" | "layout" | "loading" | "error" | "not-found";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface RouteNode {
  id: string;              // route path as ID (e.g., "/dashboard/events")
  routePath: string;
  file: string;            // relativePath
  type: RouteType;
  methods?: HttpMethod[];  // for API routes
  isClientComponent: boolean;
  isDynamic: boolean;      // has [param] or [...param]
  params: string[];        // extracted params
  parentLayout?: string;   // parent route ID
  middleware?: string[];   // middleware files that apply
}

export interface RouteGraph {
  version: string;
  generatedAt: string;
  gitCommit?: string;
  repoRoot: string;
  framework: "nextjs-app" | "nextjs-pages" | "remix" | "unknown";
  routes: RouteNode[];
  layouts: RouteNode[];
  middleware: {
    file: string;
    matcher?: string[];
  }[];
  stats: {
    totalRoutes: number;
    totalLayouts: number;
    dynamicRoutes: number;
    apiRoutes: number;
    clientPages: number;
    serverPages: number;
  };
}

// =============================================================================
// API Graph (api-graph output) - tRPC/REST/Convex
// =============================================================================

export type ApiType = "trpc" | "rest" | "convex" | "graphql";

export interface ApiEndpoint {
  id: string;
  name: string;
  type: ApiType;
  method?: HttpMethod;
  path?: string;           // REST path or Convex function path
  file: string;
  inputType?: string;      // TypeScript type as string
  outputType?: string;
  isPublic: boolean;
  auth?: string;           // auth requirement description
}

export interface ApiGraph {
  version: string;
  generatedAt: string;
  gitCommit?: string;
  repoRoot: string;
  endpoints: ApiEndpoint[];
  routers: {
    name: string;
    file: string;
    endpoints: string[];   // endpoint IDs
  }[];
  stats: {
    totalEndpoints: number;
    byType: Record<ApiType, number>;
    publicEndpoints: number;
    protectedEndpoints: number;
  };
}

// =============================================================================
// DB Graph (db-graph output) - Schema extraction
// =============================================================================

export type DbProvider = "convex" | "prisma" | "drizzle" | "sql" | "unknown";

export interface DbField {
  name: string;
  type: string;
  isOptional: boolean;
  isIndex: boolean;
  isUnique: boolean;
  default?: string;
}

export interface DbRelation {
  name: string;
  type: "one-to-one" | "one-to-many" | "many-to-many";
  from: string;            // table/collection name
  to: string;
  foreignKey?: string;
}

export interface DbTable {
  name: string;
  file: string;
  fields: DbField[];
  indexes: string[];
  relations: DbRelation[];
}

export interface DbGraph {
  version: string;
  generatedAt: string;
  gitCommit?: string;
  repoRoot: string;
  provider: DbProvider;
  tables: DbTable[];
  relations: DbRelation[];
  stats: {
    totalTables: number;
    totalFields: number;
    totalRelations: number;
    totalIndexes: number;
  };
}

// =============================================================================
// Context Slice (slice output)
// =============================================================================

export type SliceType = "route" | "feature" | "deps" | "api" | "data";

export interface SliceFile {
  relativePath: string;
  type: FileType;
  sizeBytes: number;
  depth: number;
  reason: "seed" | "import" | "layout" | "api" | "schema";
}

export interface ContextSlice {
  version: string;
  generatedAt: string;
  gitCommit?: string;
  type: SliceType;
  name: string;            // route path or feature name
  seedFiles: string[];
  files: SliceFile[];
  excluded: {
    file: string;
    reason: "size" | "depth" | "pattern" | "circular" | "external" | "token_budget";
  }[];
  summary: {
    totalFiles: number;
    totalBytes: number;
    totalTokens: number;      // Estimated token count
    maxDepth: number;
    byType: Record<FileType, number>;
  };
  /** Model this slice was budgeted for (if specified) */
  model?: LLMModel;
  /** Token budget info when model is specified */
  tokenBudget?: {
    model: LLMModel;
    contextWindow: number;
    reservedForOutput: number;
    availableForInput: number;
    used: number;
    remaining: number;
    estimatedCost?: number;   // USD
  };
  // Embedded graphs for this slice
  depGraph?: Partial<DepGraph>;
  routeGraph?: Partial<RouteGraph>;
  apiGraph?: Partial<ApiGraph>;
}

// =============================================================================
// Evaluation Result (eval output)
// =============================================================================

export type EvalSeverity = "error" | "warning" | "info";

export interface EvalIssue {
  severity: EvalSeverity;
  code: string;
  message: string;
  file?: string;
  line?: number;
  evidence?: string;
}

export interface EvalResult {
  version: string;
  generatedAt: string;
  target: string;          // file or artifact being evaluated
  passed: boolean;
  issues: EvalIssue[];
  stats: {
    errors: number;
    warnings: number;
    infos: number;
  };
}

// =============================================================================
// CLI Option Types
// =============================================================================

export interface ScanOptions {
  root?: string;
  refresh?: boolean;
  include?: string[];
  exclude?: string[];
}

export interface GraphOptions {
  root?: string;
  output?: string;
  format?: "json" | "mermaid";
  depth?: number;
  seeds?: string[];
}

// =============================================================================
// LLM Model Configuration
// =============================================================================

export type LLMModel =
  | "claude-opus-4.5"
  | "claude-sonnet-4"
  | "gpt-4o"
  | "gpt-4-turbo"
  | "o1"
  | "o3"
  | "gemini-2.0-pro"
  | "gemini-1.5-pro"
  | "custom";

export interface ModelConfig {
  name: LLMModel;
  contextWindow: number;     // Total context window in tokens
  maxOutput: number;         // Max output tokens
  reserveForOutput: number;  // Tokens to reserve for model output
  costPer1kInput?: number;   // USD per 1k input tokens
  costPer1kOutput?: number;  // USD per 1k output tokens
}

/** Known model configurations */
export const MODEL_CONFIGS: Record<Exclude<LLMModel, "custom">, ModelConfig> = {
  "claude-opus-4.5": {
    name: "claude-opus-4.5",
    contextWindow: 200000,
    maxOutput: 32000,
    reserveForOutput: 8000,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
  },
  "claude-sonnet-4": {
    name: "claude-sonnet-4",
    contextWindow: 200000,
    maxOutput: 64000,
    reserveForOutput: 8000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  "gpt-4o": {
    name: "gpt-4o",
    contextWindow: 128000,
    maxOutput: 16384,
    reserveForOutput: 4000,
    costPer1kInput: 0.005,
    costPer1kOutput: 0.015,
  },
  "gpt-4-turbo": {
    name: "gpt-4-turbo",
    contextWindow: 128000,
    maxOutput: 4096,
    reserveForOutput: 4000,
    costPer1kInput: 0.01,
    costPer1kOutput: 0.03,
  },
  "o1": {
    name: "o1",
    contextWindow: 200000,
    maxOutput: 100000,
    reserveForOutput: 16000,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.06,
  },
  "o3": {
    name: "o3",
    contextWindow: 200000,
    maxOutput: 100000,
    reserveForOutput: 16000,
    costPer1kInput: 0.01,   // TBD
    costPer1kOutput: 0.04,  // TBD
  },
  "gemini-2.0-pro": {
    name: "gemini-2.0-pro",
    contextWindow: 1000000,
    maxOutput: 8192,
    reserveForOutput: 4000,
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.005,
  },
  "gemini-1.5-pro": {
    name: "gemini-1.5-pro",
    contextWindow: 1000000,
    maxOutput: 8192,
    reserveForOutput: 4000,
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.005,
  },
};

export interface SliceOptions {
  root?: string;
  route?: string;
  seeds?: string[];
  depth?: number;
  /** @deprecated Use maxTokens with model instead */
  maxBytes?: number;
  maxFileBytes?: number;
  exclude?: string[];
  output?: string;
  /** Target model for token budgeting */
  model?: LLMModel;
  /** Max tokens for slice (overrides model default) */
  maxTokens?: number;
  /** Custom model config (when model is "custom") */
  customModelConfig?: ModelConfig;
}

export interface EvalOptions {
  root?: string;
  target: string;
  strict?: boolean;
}
