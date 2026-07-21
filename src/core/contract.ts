/**
 * Intent as a contract of expected graph deltas.
 *
 * A feature's intent compiles to a small set of expectations over the code
 * graph — "route file exists", "convex/auth.ts gains mutation resetPassword",
 * "mailer gains an inbound edge". Auditing an agent's work then becomes a
 * deterministic graph check, not an LLM opinion. Results use the 30-year-old
 * Reflexion-model vocabulary (Murphy & Notkin, FSE 1995):
 *   convergent — promised and present
 *   absent     — promised but missing
 *   divergent  — present but forbidden
 *
 * Contracts are necessary-condition gates, not oracles: a stub satisfies a
 * structural expectation, so this layers under tests, never replaces them.
 */

import type { RepoIndex, DepGraph } from "../types/index.js";
import { matchesPattern } from "./utils.js";
import { findDependents } from "./dep-graph.js";

export type Expectation =
  | { kind: "file-exists"; path: string }
  | { kind: "export-exists"; file: string; symbol: string }
  | { kind: "edge-exists"; from: string; to: string }
  | { kind: "edge-forbidden"; from: string; to: string }
  | { kind: "path-forbidden"; from: string; to: string }
  | { kind: "orphan-forbidden"; entrypoints?: string[] };

export interface Contract {
  name: string;
  description?: string;
  expect: Expectation[];
}

export type Classification = "convergent" | "absent" | "divergent";

export interface ExpectationResult {
  expectation: Expectation;
  classification: Classification;
  detail: string;
  /** For edge rules: the matching "from -> to" edges observed */
  matches?: string[];
}

export interface ContractResult {
  contract: string;
  ok: boolean;
  summary: { satisfied: number; absent: number; violated: number };
  results: ExpectationResult[];
}

/** Treat a value with glob metacharacters as a pattern, else an exact match. */
function pathMatches(value: string, pattern: string): boolean {
  if (/[*?[\]]/.test(pattern)) return matchesPattern(value, pattern);
  return value === pattern;
}

/**
 * Evaluate a contract against the current index and graph.
 */
export function evaluateContract(
  contract: Contract,
  index: RepoIndex,
  graph: DepGraph
): ContractResult {
  const files = new Set(index.files.map((f) => f.relativePath));
  const exportsByFile = new Map(
    index.files.map((f) => [f.relativePath, new Set(f.exports)] as const)
  );
  const edgeLabels = graph.edges.map((e) => `${e.from} -> ${e.to}`);

  const results: ExpectationResult[] = contract.expect.map((expectation) => {
    switch (expectation.kind) {
      case "file-exists": {
        const present = files.has(expectation.path);
        return {
          expectation,
          classification: present ? "convergent" : "absent",
          detail: present
            ? `file present: ${expectation.path}`
            : `file missing: ${expectation.path}`,
        };
      }
      case "export-exists": {
        const fileExports = exportsByFile.get(expectation.file);
        if (!fileExports) {
          return {
            expectation,
            classification: "absent",
            detail: `file not indexed: ${expectation.file}`,
          };
        }
        const present = fileExports.has(expectation.symbol);
        return {
          expectation,
          classification: present ? "convergent" : "absent",
          detail: present
            ? `${expectation.file} exports ${expectation.symbol}`
            : `${expectation.file} does not export ${expectation.symbol}`,
        };
      }
      case "edge-exists": {
        const matches = graph.edges
          .filter(
            (e) =>
              pathMatches(e.from, expectation.from) &&
              pathMatches(e.to, expectation.to)
          )
          .map((e) => `${e.from} -> ${e.to}`);
        return {
          expectation,
          classification: matches.length > 0 ? "convergent" : "absent",
          detail:
            matches.length > 0
              ? `edge present: ${matches[0]}`
              : `no edge ${expectation.from} -> ${expectation.to}`,
          matches: matches.length > 0 ? matches : undefined,
        };
      }
      case "edge-forbidden": {
        const matches = graph.edges
          .filter(
            (e) =>
              pathMatches(e.from, expectation.from) &&
              pathMatches(e.to, expectation.to)
          )
          .map((e) => `${e.from} -> ${e.to}`);
        return {
          expectation,
          classification: matches.length > 0 ? "divergent" : "convergent",
          detail:
            matches.length > 0
              ? `forbidden edge present: ${matches.join(", ")}`
              : `no forbidden ${expectation.from} -> ${expectation.to} edge`,
          matches: matches.length > 0 ? matches : undefined,
        };
      }
      case "path-forbidden": {
        // Reachability: is any `to`-matching file reachable (directly or
        // transitively) from any `from`-matching file, following imports?
        const toNodes = graph.nodes
          .map((n) => n.id)
          .filter((id) => pathMatches(id, expectation.to));
        // findDependents walks importers of `to`; a from-file that appears in
        // that closure reaches `to`.
        const reachers = new Set(findDependents(graph, toNodes).all);
        const matches = graph.nodes
          .map((n) => n.id)
          .filter((id) => pathMatches(id, expectation.from) && reachers.has(id));
        return {
          expectation,
          classification: matches.length > 0 ? "divergent" : "convergent",
          detail:
            matches.length > 0
              ? `reaches forbidden target: ${matches.join(", ")}`
              : `no path ${expectation.from} -> ${expectation.to}`,
          matches: matches.length > 0 ? matches : undefined,
        };
      }
      case "orphan-forbidden": {
        const entry = new Set(expectation.entrypoints ?? []);
        const hasOut = new Set(graph.edges.map((e) => e.from));
        const hasIn = new Set(graph.edges.map((e) => e.to));
        const orphans = graph.nodes
          .map((n) => n.id)
          .filter((id) => !hasOut.has(id) && !hasIn.has(id) && !entry.has(id));
        return {
          expectation,
          classification: orphans.length > 0 ? "divergent" : "convergent",
          detail:
            orphans.length > 0
              ? `orphan modules: ${orphans.join(", ")}`
              : "no orphan modules",
          matches: orphans.length > 0 ? orphans : undefined,
        };
      }
      default: {
        // Untrusted JSON: an unknown kind must not crash — treat it as absent.
        const kind = (expectation as { kind?: unknown }).kind;
        return {
          expectation,
          classification: "absent",
          detail: `unknown expectation kind: ${String(kind)}`,
        };
      }
    }
  });

  const summary = {
    satisfied: results.filter((r) => r.classification === "convergent").length,
    absent: results.filter((r) => r.classification === "absent").length,
    violated: results.filter((r) => r.classification === "divergent").length,
  };

  // Reference edgeLabels so the whole-edge-set is available for future rules.
  void edgeLabels;

  return {
    contract: contract.name,
    ok: summary.absent === 0 && summary.violated === 0,
    summary,
    results,
  };
}

export interface GraphSnapshot {
  version: string;
  files: string[];
  edges: string[];
  exports: string[];
}

const SNAPSHOT_VERSION = "1.0.0";

/**
 * Canonical, order-independent snapshot of the graph's structure. Two
 * snapshots diffed reveal exactly what appeared or vanished — the mechanism
 * behind delta verification (cargo-semver-checks / API Extractor pattern).
 */
export function snapshotGraph(
  graph: DepGraph,
  index: RepoIndex
): GraphSnapshot {
  const exports: string[] = [];
  for (const file of index.files) {
    for (const symbol of file.exports) {
      exports.push(`${file.relativePath}#${symbol}`);
    }
  }
  return {
    version: SNAPSHOT_VERSION,
    files: index.files.map((f) => f.relativePath).sort(),
    edges: graph.edges.map((e) => `${e.from} -> ${e.to}`).sort(),
    exports: exports.sort(),
  };
}

export interface SnapshotDiff {
  addedFiles: string[];
  removedFiles: string[];
  addedEdges: string[];
  removedEdges: string[];
  addedExports: string[];
  removedExports: string[];
}

function difference(a: string[], b: string[]): string[] {
  const bSet = new Set(b);
  return a.filter((x) => !bSet.has(x));
}

/**
 * What changed between two snapshots (before -> after).
 */
export function diffSnapshots(
  before: GraphSnapshot,
  after: GraphSnapshot
): SnapshotDiff {
  return {
    addedFiles: difference(after.files, before.files),
    removedFiles: difference(before.files, after.files),
    addedEdges: difference(after.edges, before.edges),
    removedEdges: difference(before.edges, after.edges),
    addedExports: difference(after.exports, before.exports),
    removedExports: difference(before.exports, after.exports),
  };
}

/**
 * Derive an expected-delta contract from an observed diff — turn "here is what
 * the agent actually did" into "here is what a future run must reproduce".
 */
export function deriveContractFromDiff(
  name: string,
  diff: SnapshotDiff
): Contract {
  const expect: Expectation[] = [];
  for (const path of diff.addedFiles) expect.push({ kind: "file-exists", path });
  for (const edge of diff.addedEdges) {
    const [from, to] = edge.split(" -> ");
    if (from && to) expect.push({ kind: "edge-exists", from, to });
  }
  for (const exp of diff.addedExports) {
    const [file, symbol] = exp.split("#");
    if (file && symbol) expect.push({ kind: "export-exists", file, symbol });
  }
  return { name, description: "Derived from observed graph delta", expect };
}
