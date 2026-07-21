/**
 * Stable, prefix-safe symbol identifiers modelled on Sourcegraph's SCIP
 * grammar. A symbol's id depends only on (package, path, name, kind), so it
 * survives re-indexing — the prerequisite for diffing graph deltas: a node is
 * only comparable across runs if its identity is stable.
 *
 * Format: `<package> <version> <path>/<name><descriptor>`
 *   descriptor: `.` term, `#` type, `().` method/function, `/` namespace
 */

export type SymbolKind = "term" | "type" | "function" | "namespace";

export interface PackageRef {
  name: string;
  version?: string;
}

const DESCRIPTOR: Record<SymbolKind, string> = {
  term: ".",
  type: "#",
  function: "().",
  namespace: "/",
};

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Build a stable SCIP-style symbol id.
 */
export function scipSymbol(
  pkg: PackageRef,
  filePath: string,
  name: string,
  kind: SymbolKind
): string {
  const version = pkg.version && pkg.version.length > 0 ? pkg.version : ".";
  return `${pkg.name} ${version} ${normalizePath(filePath)}/${name}${DESCRIPTOR[kind]}`;
}

/**
 * Symbol id for the file itself (a namespace).
 */
export function fileSymbol(pkg: PackageRef, filePath: string): string {
  const version = pkg.version && pkg.version.length > 0 ? pkg.version : ".";
  return `${pkg.name} ${version} ${normalizePath(filePath)}/`;
}

/**
 * Classify each top-level export by SCIP kind from source text.
 */
export function classifyExports(content: string): Record<string, SymbolKind> {
  const kinds: Record<string, SymbolKind> = {};

  const decl =
    /^[ \t]*export\s+(?:default\s+)?(?:async\s+)?(const|let|var|function|class|interface|type|enum)\s+(\w+)/gm;
  for (const m of content.matchAll(decl)) {
    const [, keyword, name] = m;
    if (keyword === "function") kinds[name] = "function";
    else if (
      keyword === "class" ||
      keyword === "interface" ||
      keyword === "type" ||
      keyword === "enum"
    )
      kinds[name] = "type";
    else kinds[name] = "term";
  }

  return kinds;
}
