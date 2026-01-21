import * as path from "node:path";
import type {
  ContextSlice,
  FileInfo,
  RepoIndex,
  DepGraph,
  ApiGraph,
  FileType,
} from "../types/index.js";
import { readFileSafe } from "./utils.js";
import { getIndex } from "./indexer.js";
import { buildDepGraphFromSeeds } from "./dep-graph.js";
import { buildApiGraph } from "./api-graph.js";

const VISUALIZER_VERSION = "1.0.0";

// =============================================================================
// Types
// =============================================================================

export interface DataFlowNode {
  id: string;
  label: string;
  type: "page" | "component" | "hook" | "api" | "database" | "external";
  isClient: boolean;
  file?: string;
}

export interface DataFlowEdge {
  from: string;
  to: string;
  label?: string;
  type: "import" | "query" | "mutation" | "fetch" | "state" | "props";
  method?: string; // GET, POST, etc.
}

export interface DataFlowGraph {
  version: string;
  name: string;
  nodes: DataFlowNode[];
  edges: DataFlowEdge[];
  layers: {
    ui: string[];
    logic: string[];
    api: string[];
    data: string[];
  };
}

export interface VisualizationOptions {
  root?: string;
  includeExternal?: boolean;
  maxNodes?: number;
  direction?: "TD" | "LR" | "BT" | "RL";
}

// =============================================================================
// API Call Detection
// =============================================================================

interface ApiCall {
  type: "useQuery" | "useMutation" | "useAction" | "fetch" | "api";
  target?: string; // API function name or URL
  method?: string; // HTTP method for fetch
  line?: number;
}

/**
 * Strip comments from source code to avoid false positives
 */
function stripComments(content: string): string {
  // Remove single-line comments (but preserve URLs with //)
  let result = content.replace(/(?<!:)\/\/.*$/gm, "");
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, "");
  return result;
}

/**
 * Extract API calls from file content
 */
function extractApiCalls(content: string, relativePath: string): ApiCall[] {
  const calls: ApiCall[] = [];

  // Strip comments to avoid matching examples in documentation
  const codeOnly = stripComments(content);

  // Convex useQuery calls
  const useQueryPattern = /useQuery\s*\(\s*(api\.[\w.]+)/g;
  let match;
  while ((match = useQueryPattern.exec(codeOnly)) !== null) {
    calls.push({
      type: "useQuery",
      target: match[1],
    });
  }

  // Convex useMutation calls
  const useMutationPattern = /useMutation\s*\(\s*(api\.[\w.]+)/g;
  while ((match = useMutationPattern.exec(codeOnly)) !== null) {
    calls.push({
      type: "useMutation",
      target: match[1],
    });
  }

  // Convex useAction calls
  const useActionPattern = /useAction\s*\(\s*(api\.[\w.]+)/g;
  while ((match = useActionPattern.exec(codeOnly)) !== null) {
    calls.push({
      type: "useAction",
      target: match[1],
    });
  }

  // Fetch calls with URL
  const fetchPattern = /fetch\s*\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*\{[^}]*method\s*:\s*['"`](\w+)['"`])?/g;
  while ((match = fetchPattern.exec(codeOnly)) !== null) {
    calls.push({
      type: "fetch",
      target: match[1],
      method: match[2] || "GET",
    });
  }

  // React Query / TanStack Query
  const tanstackPattern = /useQuery\s*\(\s*\{[^}]*queryKey\s*:\s*\[['"`]([^'"`]+)['"`]/g;
  while ((match = tanstackPattern.exec(codeOnly)) !== null) {
    calls.push({
      type: "useQuery",
      target: match[1],
    });
  }

  return calls;
}

/**
 * Extract state management patterns
 */
function extractStatePatterns(content: string): { hooks: string[]; contexts: string[] } {
  const hooks: string[] = [];
  const contexts: string[] = [];

  // useState hooks
  const useStatePattern = /const\s+\[(\w+),\s*set\w+\]\s*=\s*useState/g;
  let match;
  while ((match = useStatePattern.exec(content)) !== null) {
    hooks.push(`state:${match[1]}`);
  }

  // useReducer hooks
  const useReducerPattern = /const\s+\[(\w+),\s*\w+\]\s*=\s*useReducer/g;
  while ((match = useReducerPattern.exec(content)) !== null) {
    hooks.push(`reducer:${match[1]}`);
  }

  // useContext usage
  const useContextPattern = /useContext\s*\(\s*(\w+)/g;
  while ((match = useContextPattern.exec(content)) !== null) {
    contexts.push(match[1]);
  }

  return { hooks, contexts };
}

// =============================================================================
// Data Flow Graph Builder
// =============================================================================

/**
 * Build a data flow graph from a context slice
 */
export async function buildDataFlowGraph(
  slice: ContextSlice,
  options: VisualizationOptions = {}
): Promise<DataFlowGraph> {
  const root = options.root || process.cwd();
  const maxNodes = options.maxNodes || 50;

  const nodes: DataFlowNode[] = [];
  const edges: DataFlowEdge[] = [];
  const nodeMap = new Map<string, DataFlowNode>();

  // Track layers
  const layers = {
    ui: [] as string[],
    logic: [] as string[],
    api: [] as string[],
    data: [] as string[],
  };

  // Get index for full file info
  const index = await getIndex({ root });
  const fileInfoMap = new Map<string, FileInfo>();
  for (const file of index.files) {
    fileInfoMap.set(file.relativePath, file);
  }

  // Build a set of files in the slice for quick lookup
  const sliceFileSet = new Set(slice.files.map((f) => f.relativePath));

  // Process each file in the slice
  for (const sliceFile of slice.files.slice(0, maxNodes)) {
    const fileInfo = fileInfoMap.get(sliceFile.relativePath);
    const content = readFileSafe(path.join(root, sliceFile.relativePath)) || "";

    const nodeId = sanitizeId(sliceFile.relativePath);
    const label = path.basename(sliceFile.relativePath).replace(/\.[^.]+$/, "");
    const isClient = fileInfo?.isClientComponent ?? content.includes('"use client"');

    // Determine node type based on file type and content
    let nodeType: DataFlowNode["type"] = "component";
    if (sliceFile.type === "page" || sliceFile.type === "layout") {
      nodeType = "page";
    } else if (sliceFile.type === "hook") {
      nodeType = "hook";
    } else if (sliceFile.type === "api" || sliceFile.type === "route") {
      nodeType = "api";
    } else if (sliceFile.type === "schema") {
      nodeType = "database";
    } else if (sliceFile.type === "lib" || sliceFile.type === "type") {
      nodeType = "component"; // Utility files shown as components
    }

    const node: DataFlowNode = {
      id: nodeId,
      label,
      type: nodeType,
      isClient,
      file: sliceFile.relativePath,
    };

    nodes.push(node);
    nodeMap.set(sliceFile.relativePath, node);

    // Categorize into layers based on type
    if (nodeType === "page") {
      layers.ui.push(nodeId);
    } else if (nodeType === "hook") {
      layers.logic.push(nodeId);
    } else if (nodeType === "api") {
      layers.api.push(nodeId);
    } else if (nodeType === "database") {
      layers.data.push(nodeId);
    } else {
      // Components and libs go to logic layer
      layers.logic.push(nodeId);
    }

    // Extract API calls and create edges
    const apiCalls = extractApiCalls(content, sliceFile.relativePath);
    for (const call of apiCalls) {
      const targetId = call.target ? sanitizeId(call.target) : `external_${edges.length}`;

      // Add external API node if not already present
      if (call.target && !nodeMap.has(call.target)) {
        const apiNode: DataFlowNode = {
          id: targetId,
          label: call.target.split(".").pop() || call.target,
          type: call.type === "fetch" ? "external" : "api",
          isClient: false,
        };
        nodes.push(apiNode);
        nodeMap.set(call.target, apiNode);
        layers.api.push(targetId);
      }

      edges.push({
        from: nodeId,
        to: targetId,
        label: call.method || call.type,
        type: call.type === "fetch" ? "fetch" : call.type === "useMutation" ? "mutation" : "query",
        method: call.method,
      });
    }
  }

  // Build dependency graph from seeds to get import relationships
  const seedFiles = slice.seedFiles.length > 0 ? slice.seedFiles : slice.files.slice(0, 3).map(f => f.relativePath);
  const depGraph = await buildDepGraphFromSeeds(seedFiles, { root, depth: 10 });

  // Add import edges from the dep graph
  for (const edge of depGraph.edges) {
    // Only add edges where both nodes are in the slice
    if (sliceFileSet.has(edge.from) && sliceFileSet.has(edge.to)) {
      const fromId = sanitizeId(edge.from);
      const toId = sanitizeId(edge.to);

      // Check if this edge already exists
      const exists = edges.some((e) => e.from === fromId && e.to === toId);
      if (!exists) {
        edges.push({
          from: fromId,
          to: toId,
          type: "import",
        });
      }
    }
  }

  return {
    version: VISUALIZER_VERSION,
    name: slice.name,
    nodes,
    edges,
    layers,
  };
}

// =============================================================================
// Mermaid Generators
// =============================================================================

/**
 * Generate a client-server data flow diagram
 */
export function dataFlowToMermaid(
  graph: DataFlowGraph,
  options: { direction?: "TD" | "LR" } = {}
): string {
  const direction = options.direction || "TD";
  const lines: string[] = [`graph ${direction}`];

  // Add title comment
  lines.push(`  %% Data Flow: ${graph.name}`);
  lines.push("");

  // Create subgraphs for client/server boundary
  const clientNodes = graph.nodes.filter((n) => n.isClient);
  const serverNodes = graph.nodes.filter((n) => !n.isClient);

  // Client subgraph
  if (clientNodes.length > 0) {
    lines.push('  subgraph Client["Client (Browser)"]');
    lines.push("    direction TB");
    for (const node of clientNodes) {
      const shape = getNodeShape(node);
      lines.push(`    ${node.id}${shape}`);
    }
    lines.push("  end");
    lines.push("");
  }

  // Server subgraph
  if (serverNodes.length > 0) {
    lines.push('  subgraph Server["Server"]');
    lines.push("    direction TB");
    for (const node of serverNodes) {
      const shape = getNodeShape(node);
      lines.push(`    ${node.id}${shape}`);
    }
    lines.push("  end");
    lines.push("");
  }

  // Add edges with labels
  for (const edge of graph.edges) {
    const arrow = getEdgeArrow(edge);
    const label = edge.label ? `|${edge.label}|` : "";
    lines.push(`  ${edge.from} ${arrow}${label} ${edge.to}`);
  }

  // Add styles
  lines.push("");
  lines.push("  %% Styles");
  lines.push("  classDef page fill:#e3f2fd,stroke:#1565c0,stroke-width:2px");
  lines.push("  classDef component fill:#e8f5e9,stroke:#2e7d32");
  lines.push("  classDef hook fill:#fff3e0,stroke:#ef6c00");
  lines.push("  classDef api fill:#fce4ec,stroke:#c2185b");
  lines.push("  classDef database fill:#f3e5f5,stroke:#7b1fa2");
  lines.push("  classDef external fill:#eceff1,stroke:#546e7a,stroke-dasharray: 5 5");

  // Apply styles
  for (const node of graph.nodes) {
    lines.push(`  class ${node.id} ${node.type}`);
  }

  return lines.join("\n");
}

/**
 * Generate a layered architecture diagram
 */
export function architectureToMermaid(
  graph: DataFlowGraph,
  options: { direction?: "TD" | "LR" } = {}
): string {
  const direction = options.direction || "TD";
  const lines: string[] = [`graph ${direction}`];

  lines.push(`  %% Architecture: ${graph.name}`);
  lines.push("");

  // UI Layer
  if (graph.layers.ui.length > 0) {
    lines.push('  subgraph UI["UI Layer"]');
    for (const id of graph.layers.ui) {
      const node = graph.nodes.find((n) => n.id === id);
      if (node) {
        lines.push(`    ${id}[["${node.label}"]]`);
      }
    }
    lines.push("  end");
    lines.push("");
  }

  // Logic Layer
  if (graph.layers.logic.length > 0) {
    lines.push('  subgraph Logic["Components & Hooks"]');
    for (const id of graph.layers.logic) {
      const node = graph.nodes.find((n) => n.id === id);
      if (node) {
        const shape = node.type === "hook" ? `((${node.label}))` : `["${node.label}"]`;
        lines.push(`    ${id}${shape}`);
      }
    }
    lines.push("  end");
    lines.push("");
  }

  // API Layer
  if (graph.layers.api.length > 0) {
    lines.push('  subgraph API["API Layer"]');
    for (const id of graph.layers.api) {
      const node = graph.nodes.find((n) => n.id === id);
      if (node) {
        lines.push(`    ${id}{{"${node.label}"}}`);
      }
    }
    lines.push("  end");
    lines.push("");
  }

  // Data Layer
  if (graph.layers.data.length > 0) {
    lines.push('  subgraph Data["Data Layer"]');
    for (const id of graph.layers.data) {
      const node = graph.nodes.find((n) => n.id === id);
      if (node) {
        lines.push(`    ${id}[("${node.label}")]`);
      }
    }
    lines.push("  end");
    lines.push("");
  }

  // Add data flow edges (queries and mutations only)
  const dataEdges = graph.edges.filter((e) => e.type !== "import");
  for (const edge of dataEdges) {
    const label = edge.label ? `|${edge.label}|` : "";
    const arrow = edge.type === "mutation" ? "==>" : "-->";
    lines.push(`  ${edge.from} ${arrow}${label} ${edge.to}`);
  }

  // Styles
  lines.push("");
  lines.push("  classDef ui fill:#e3f2fd,stroke:#1565c0");
  lines.push("  classDef logic fill:#e8f5e9,stroke:#2e7d32");
  lines.push("  classDef api fill:#fff3e0,stroke:#ef6c00");
  lines.push("  classDef data fill:#f3e5f5,stroke:#7b1fa2");

  return lines.join("\n");
}

/**
 * Generate a sequence diagram for request/response flow
 */
export function requestFlowToMermaid(graph: DataFlowGraph): string {
  const lines: string[] = ["sequenceDiagram"];
  lines.push(`  %% Request Flow: ${graph.name}`);
  lines.push("");

  // Group participants
  const participants = new Map<string, string>();

  // Add page/component participants first
  for (const node of graph.nodes.filter((n) => n.type === "page" || n.type === "component")) {
    const alias = node.label.substring(0, 15);
    participants.set(node.id, alias);
    lines.push(`  participant ${node.id} as ${alias}`);
  }

  // Add API participants
  for (const node of graph.nodes.filter((n) => n.type === "api" || n.type === "external")) {
    const alias = node.label.substring(0, 15);
    participants.set(node.id, alias);
    lines.push(`  participant ${node.id} as ${alias}`);
  }

  lines.push("");

  // Add interactions based on edges
  for (const edge of graph.edges) {
    if (edge.type === "import") continue;

    const from = participants.get(edge.from);
    const to = participants.get(edge.to);

    if (from && to) {
      const label = edge.label || edge.type;

      if (edge.type === "query") {
        lines.push(`  ${edge.from}->>+${edge.to}: ${label}`);
        lines.push(`  ${edge.to}-->>-${edge.from}: data`);
      } else if (edge.type === "mutation") {
        lines.push(`  ${edge.from}->>+${edge.to}: ${label}`);
        lines.push(`  ${edge.to}-->>-${edge.from}: result`);
      } else if (edge.type === "fetch") {
        const method = edge.method || "GET";
        lines.push(`  ${edge.from}->>+${edge.to}: ${method}`);
        lines.push(`  ${edge.to}-->>-${edge.from}: response`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Generate a component dependency diagram showing hooks
 */
export function componentDepsToMermaid(
  graph: DataFlowGraph,
  options: { direction?: "TD" | "LR" } = {}
): string {
  const direction = options.direction || "LR";
  const lines: string[] = [`flowchart ${direction}`];

  lines.push(`  %% Component Dependencies: ${graph.name}`);
  lines.push("");

  // Group by type
  const pages = graph.nodes.filter((n) => n.type === "page");
  const components = graph.nodes.filter((n) => n.type === "component");
  const hooks = graph.nodes.filter((n) => n.type === "hook");
  const apis = graph.nodes.filter((n) => n.type === "api" || n.type === "external");

  // Add nodes with shapes
  for (const node of pages) {
    lines.push(`  ${node.id}[["${node.label}"]]:::page`);
  }

  for (const node of components) {
    const client = node.isClient ? "Client" : "Server";
    lines.push(`  ${node.id}["${node.label}<br/><small>${client}</small>"]:::component`);
  }

  for (const node of hooks) {
    lines.push(`  ${node.id}(("${node.label}")):::hook`);
  }

  for (const node of apis) {
    lines.push(`  ${node.id}{{"${node.label}"}}:::api`);
  }

  lines.push("");

  // Add edges
  for (const edge of graph.edges) {
    const style = edge.type === "import" ? "-->" : "-.->|" + (edge.label || edge.type) + "|";
    lines.push(`  ${edge.from} ${style} ${edge.to}`);
  }

  // Styles
  lines.push("");
  lines.push("  classDef page fill:#e3f2fd,stroke:#1565c0,stroke-width:2px");
  lines.push("  classDef component fill:#e8f5e9,stroke:#2e7d32");
  lines.push("  classDef hook fill:#fff3e0,stroke:#ef6c00,stroke-width:2px");
  lines.push("  classDef api fill:#fce4ec,stroke:#c2185b");

  return lines.join("\n");
}

// =============================================================================
// Combined Visualization
// =============================================================================

export interface SliceVisualization {
  dataFlow: string;
  architecture: string;
  requestFlow: string;
  componentDeps: string;
  graph: DataFlowGraph;
}

/**
 * Generate all visualizations for a slice
 */
export async function visualizeSlice(
  slice: ContextSlice,
  options: VisualizationOptions = {}
): Promise<SliceVisualization> {
  const graph = await buildDataFlowGraph(slice, options);

  return {
    dataFlow: dataFlowToMermaid(graph, { direction: options.direction }),
    architecture: architectureToMermaid(graph, { direction: options.direction }),
    requestFlow: requestFlowToMermaid(graph),
    componentDeps: componentDepsToMermaid(graph, { direction: options.direction }),
    graph,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

function getNodeShape(node: DataFlowNode): string {
  switch (node.type) {
    case "page":
      return `[["${node.label}"]]`;
    case "component":
      return `["${node.label}"]`;
    case "hook":
      return `(("${node.label}"))`;
    case "api":
      return `{{"${node.label}"}}`;
    case "database":
      return `[("${node.label}")]`;
    case "external":
      return `>"${node.label}"]`;
    default:
      return `["${node.label}"]`;
  }
}

function getEdgeArrow(edge: DataFlowEdge): string {
  switch (edge.type) {
    case "query":
      return "-.->"; // Dotted for reads
    case "mutation":
      return "==>"; // Thick for writes
    case "fetch":
      return "-->";
    case "import":
      return "-->"; // Solid for imports
    case "state":
      return "~~~"; // Wavy for state
    case "props":
      return "-->"; // Props flow down
    default:
      return "-->";
  }
}
