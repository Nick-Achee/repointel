/**
 * repointel - Repo intelligence library
 *
 * Programmatic API for generating architecture graphs and context slices.
 *
 * @example
 * ```ts
 * import { generateIndex, buildDepGraph, buildRouteGraph } from 'repointel';
 *
 * // Scan repository
 * const index = await generateIndex({ root: '/path/to/repo' });
 *
 * // Build dependency graph
 * const depGraph = await buildDepGraph({ root: '/path/to/repo' });
 *
 * // Build route graph
 * const routeGraph = await buildRouteGraph({ root: '/path/to/repo' });
 * ```
 */

// Types
export * from "./types/index.js";

// Core - Indexer
export {
  generateIndex,
  saveIndex,
  loadIndex,
  getIndex,
} from "./core/indexer.js";

// Core - Dependency Graph
export {
  buildDepGraph,
  buildDepGraphFromSeeds,
  expandSeeds,
  findDependents,
  findSCCs,
  saveDepGraph,
  loadDepGraph,
  depGraphToMermaid,
} from "./core/dep-graph.js";

// Core - Stable symbol identifiers
export {
  scipSymbol,
  fileSymbol,
  classifyExports,
  type SymbolKind,
  type PackageRef,
} from "./core/symbol-id.js";

// Core - Route Graph
export {
  buildRouteGraph,
  saveRouteGraph,
  loadRouteGraph,
  routeGraphToMermaid,
} from "./core/route-graph.js";

// Core - API Graph
export {
  buildApiGraph,
  saveApiGraph,
  loadApiGraph,
  apiGraphToMermaid,
} from "./core/api-graph.js";

// Core - Slicer
export {
  sliceRoute,
  sliceFeature,
  generateContextPack,
  saveSlice,
  saveContextPack,
} from "./core/slicer.js";

// Core - Utilities
export {
  getGitCommit,
  getGitBranch,
  getGitState,
  getProjectIdentity,
  hashFile,
  readFileSafe,
  getFileSize,
  ensureDir,
  writeJson,
  readJson,
  formatBytes,
  filePathToRoutePath,
  extractRouteParams,
  matchesPattern,
  matchesPatterns,
} from "./core/utils.js";

// Commands - OODA payload (shared by `ooda --json` and the MCP server)
export { buildOodaPayload } from "./commands/ooda.js";

// Validators
export {
  validateRepoIndex,
  validateDepGraph,
  validateRouteGraph,
  validateArtifact,
  validateAll,
} from "./validators/eval.js";
