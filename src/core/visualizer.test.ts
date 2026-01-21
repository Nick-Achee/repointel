import { describe, it, expect } from "vitest";
import {
  dataFlowToMermaid,
  architectureToMermaid,
  requestFlowToMermaid,
  componentDepsToMermaid,
  buildDataFlowGraph,
  type DataFlowGraph,
  type DataFlowNode,
  type DataFlowEdge,
} from "./visualizer.js";

// Helper to create a test graph
function createTestGraph(overrides: Partial<DataFlowGraph> = {}): DataFlowGraph {
  return {
    version: "1.0.0",
    name: "test-feature",
    nodes: [],
    edges: [],
    layers: {
      ui: [],
      logic: [],
      api: [],
      data: [],
    },
    ...overrides,
  };
}

describe("dataFlowToMermaid", () => {
  it("generates valid mermaid graph header", () => {
    const graph = createTestGraph();
    const result = dataFlowToMermaid(graph);

    expect(result).toContain("graph TD");
    expect(result).toContain("%% Data Flow: test-feature");
  });

  it("uses LR direction when specified", () => {
    const graph = createTestGraph();
    const result = dataFlowToMermaid(graph, { direction: "LR" });

    expect(result).toContain("graph LR");
  });

  it("separates client and server nodes into subgraphs", () => {
    const nodes: DataFlowNode[] = [
      { id: "client_comp", label: "ClientComp", type: "component", isClient: true },
      { id: "server_comp", label: "ServerComp", type: "component", isClient: false },
    ];
    const graph = createTestGraph({ nodes });
    const result = dataFlowToMermaid(graph);

    expect(result).toContain('subgraph Client["Client (Browser)"]');
    expect(result).toContain('subgraph Server["Server"]');
    expect(result).toContain("client_comp");
    expect(result).toContain("server_comp");
  });

  it("generates edges with labels", () => {
    const nodes: DataFlowNode[] = [
      { id: "comp", label: "Component", type: "component", isClient: true },
      { id: "api_func", label: "getUser", type: "api", isClient: false },
    ];
    const edges: DataFlowEdge[] = [
      { from: "comp", to: "api_func", label: "useQuery", type: "query" },
    ];
    const graph = createTestGraph({ nodes, edges });
    const result = dataFlowToMermaid(graph);

    expect(result).toContain("comp -.->|useQuery| api_func");
  });

  it("uses different arrow styles for different edge types", () => {
    const nodes: DataFlowNode[] = [
      { id: "a", label: "A", type: "component", isClient: true },
      { id: "b", label: "B", type: "api", isClient: false },
      { id: "c", label: "C", type: "api", isClient: false },
    ];
    const edges: DataFlowEdge[] = [
      { from: "a", to: "b", type: "query" },
      { from: "a", to: "c", type: "mutation" },
    ];
    const graph = createTestGraph({ nodes, edges });
    const result = dataFlowToMermaid(graph);

    expect(result).toContain("a -.-> b"); // dotted for query
    expect(result).toContain("a ==> c"); // thick for mutation
  });

  it("includes style definitions", () => {
    const graph = createTestGraph();
    const result = dataFlowToMermaid(graph);

    expect(result).toContain("classDef page");
    expect(result).toContain("classDef component");
    expect(result).toContain("classDef hook");
    expect(result).toContain("classDef api");
  });

  it("uses correct node shapes based on type", () => {
    const nodes: DataFlowNode[] = [
      { id: "page1", label: "Home", type: "page", isClient: false },
      { id: "hook1", label: "useAuth", type: "hook", isClient: true },
      { id: "api1", label: "getUser", type: "api", isClient: false },
      { id: "db1", label: "users", type: "database", isClient: false },
    ];
    const graph = createTestGraph({ nodes });
    const result = dataFlowToMermaid(graph);

    expect(result).toContain('page1[["Home"]]'); // stadium shape for pages
    expect(result).toContain('hook1(("useAuth"))'); // circle for hooks
    expect(result).toContain('api1{{"getUser"}}'); // hexagon for api
    expect(result).toContain('db1[("users")]'); // cylinder for database
  });
});

describe("architectureToMermaid", () => {
  it("generates valid mermaid graph with layers", () => {
    const graph = createTestGraph({
      layers: {
        ui: ["page1"],
        logic: ["hook1"],
        api: ["api1"],
        data: ["db1"],
      },
      nodes: [
        { id: "page1", label: "Home", type: "page", isClient: false },
        { id: "hook1", label: "useAuth", type: "hook", isClient: true },
        { id: "api1", label: "getUser", type: "api", isClient: false },
        { id: "db1", label: "users", type: "database", isClient: false },
      ],
    });
    const result = architectureToMermaid(graph);

    expect(result).toContain('subgraph UI["UI Layer"]');
    expect(result).toContain('subgraph Logic["Components & Hooks"]');
    expect(result).toContain('subgraph API["API Layer"]');
    expect(result).toContain('subgraph Data["Data Layer"]');
  });

  it("only shows data flow edges, not imports", () => {
    const nodes: DataFlowNode[] = [
      { id: "a", label: "A", type: "component", isClient: true },
      { id: "b", label: "B", type: "api", isClient: false },
    ];
    const edges: DataFlowEdge[] = [
      { from: "a", to: "b", type: "import" },
      { from: "a", to: "b", type: "query", label: "getData" },
    ];
    const graph = createTestGraph({ nodes, edges });
    const result = architectureToMermaid(graph);

    expect(result).toContain("getData");
    // Import edges should not appear in architecture diagram data flow section
    const dataFlowLines = result.split("\n").filter(l => l.includes("-->") || l.includes("==>"));
    expect(dataFlowLines.length).toBe(1);
  });

  it("uses thick arrows for mutations", () => {
    const nodes: DataFlowNode[] = [
      { id: "a", label: "A", type: "component", isClient: true },
      { id: "b", label: "B", type: "api", isClient: false },
    ];
    const edges: DataFlowEdge[] = [
      { from: "a", to: "b", type: "mutation", label: "createUser" },
    ];
    const graph = createTestGraph({ nodes, edges });
    const result = architectureToMermaid(graph);

    expect(result).toContain("a ==>|createUser| b");
  });
});

describe("requestFlowToMermaid", () => {
  it("generates valid sequence diagram", () => {
    const graph = createTestGraph();
    const result = requestFlowToMermaid(graph);

    expect(result).toContain("sequenceDiagram");
    expect(result).toContain("%% Request Flow: test-feature");
  });

  it("creates participants for pages and APIs", () => {
    const nodes: DataFlowNode[] = [
      { id: "page1", label: "Dashboard", type: "page", isClient: true },
      { id: "api1", label: "getUsers", type: "api", isClient: false },
    ];
    const graph = createTestGraph({ nodes });
    const result = requestFlowToMermaid(graph);

    expect(result).toContain("participant page1 as Dashboard");
    expect(result).toContain("participant api1 as getUsers");
  });

  it("shows query request/response pattern", () => {
    const nodes: DataFlowNode[] = [
      { id: "comp", label: "List", type: "component", isClient: true },
      { id: "api", label: "getItems", type: "api", isClient: false },
    ];
    const edges: DataFlowEdge[] = [
      { from: "comp", to: "api", type: "query", label: "useQuery" },
    ];
    const graph = createTestGraph({ nodes, edges });
    const result = requestFlowToMermaid(graph);

    expect(result).toContain("comp->>+api: useQuery");
    expect(result).toContain("api-->>-comp: data");
  });

  it("shows mutation request/response pattern", () => {
    const nodes: DataFlowNode[] = [
      { id: "form", label: "Form", type: "component", isClient: true },
      { id: "api", label: "createItem", type: "api", isClient: false },
    ];
    const edges: DataFlowEdge[] = [
      { from: "form", to: "api", type: "mutation", label: "useMutation" },
    ];
    const graph = createTestGraph({ nodes, edges });
    const result = requestFlowToMermaid(graph);

    expect(result).toContain("form->>+api: useMutation");
    expect(result).toContain("api-->>-form: result");
  });

  it("shows fetch with HTTP method", () => {
    const nodes: DataFlowNode[] = [
      { id: "comp", label: "Comp", type: "component", isClient: true },
      { id: "ext", label: "/api/data", type: "external", isClient: false },
    ];
    const edges: DataFlowEdge[] = [
      { from: "comp", to: "ext", type: "fetch", method: "POST" },
    ];
    const graph = createTestGraph({ nodes, edges });
    const result = requestFlowToMermaid(graph);

    expect(result).toContain("comp->>+ext: POST");
    expect(result).toContain("ext-->>-comp: response");
  });
});

describe("componentDepsToMermaid", () => {
  it("generates valid flowchart", () => {
    const graph = createTestGraph();
    const result = componentDepsToMermaid(graph);

    expect(result).toContain("flowchart LR");
    expect(result).toContain("%% Component Dependencies: test-feature");
  });

  it("uses TD direction when specified", () => {
    const graph = createTestGraph();
    const result = componentDepsToMermaid(graph, { direction: "TD" });

    expect(result).toContain("flowchart TD");
  });

  it("shows client/server labels for components", () => {
    const nodes: DataFlowNode[] = [
      { id: "client", label: "ClientComp", type: "component", isClient: true },
      { id: "server", label: "ServerComp", type: "component", isClient: false },
    ];
    const graph = createTestGraph({ nodes });
    const result = componentDepsToMermaid(graph);

    expect(result).toContain("Client");
    expect(result).toContain("Server");
  });

  it("includes both import and data flow edges", () => {
    const nodes: DataFlowNode[] = [
      { id: "a", label: "A", type: "component", isClient: true },
      { id: "b", label: "B", type: "component", isClient: false },
      { id: "c", label: "C", type: "api", isClient: false },
    ];
    const edges: DataFlowEdge[] = [
      { from: "a", to: "b", type: "import" },
      { from: "a", to: "c", type: "query", label: "getData" },
    ];
    const graph = createTestGraph({ nodes, edges });
    const result = componentDepsToMermaid(graph);

    expect(result).toContain("a --> b");
    expect(result).toContain("getData");
  });
});
