import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import { snapshotGraph, diffSnapshots, type SnapshotDiff } from "./contract.js";
import { inferBoundaries } from "./understand.js";

export interface DriftOptions {
  root?: string;
}

export interface DriftReport {
  sinceRef: string;
  provenance: "measured";
  diff: SnapshotDiff;
  crossBoundaryEdges: string[]; // added edges that cross a directory boundary
  newCycles: number;
  questions: string[];
  error?: string;
}

const EMPTY_DIFF: SnapshotDiff = {
  addedFiles: [], removedFiles: [], addedEdges: [], removedEdges: [],
  addedExports: [], removedExports: [],
};

/** Extract a git ref's tree into a temp dir, non-invasively (no working-tree
 *  mutation). Returns the temp dir, or null if the ref does not resolve. */
function extractRef(root: string, ref: string): string | null {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-ref-"));
  const tarPath = path.join(tmp, "ref.tar");
  try {
    execFileSync("git", ["archive", "--format=tar", "-o", tarPath, ref], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    execFileSync("tar", ["-xf", tarPath, "-C", tmp], { stdio: ["pipe", "pipe", "pipe"] });
    fs.rmSync(tarPath, { force: true });
    return tmp;
  } catch {
    fs.rmSync(tmp, { recursive: true, force: true });
    return null;
  }
}

export async function buildDrift(
  sinceRef: string,
  options: DriftOptions = {}
): Promise<DriftReport> {
  const root = options.root || process.cwd();

  const refDir = extractRef(root, sinceRef);
  if (!refDir) {
    return {
      sinceRef,
      provenance: "measured",
      diff: EMPTY_DIFF,
      crossBoundaryEdges: [],
      newCycles: 0,
      questions: [],
      error: `Could not resolve git ref: ${sinceRef}`,
    };
  }

  try {
    const [curIndex, curGraph, refIndex, refGraph] = await Promise.all([
      generateIndex({ root }),
      buildDepGraph({ root }),
      generateIndex({ root: refDir }),
      buildDepGraph({ root: refDir }),
    ]);

    const before = snapshotGraph(refGraph, refIndex);
    const after = snapshotGraph(curGraph, curIndex);
    const diff = diffSnapshots(before, after);

    const boundaryOf = new Map<string, string>();
    for (const b of inferBoundaries(curIndex, curGraph)) {
      for (const f of curIndex.files) {
        if (b.globs.some((g) => f.relativePath.startsWith(`src/${b.label}/`)))
          boundaryOf.set(f.relativePath, b.label);
      }
    }
    const crossBoundaryEdges = diff.addedEdges.filter((e) => {
      const [from, to] = e.split(" -> ");
      const a = boundaryOf.get(from);
      const b = boundaryOf.get(to);
      return a && b && a !== b;
    });

    const newCycles = Math.max(0, curGraph.cycles.length - refGraph.cycles.length);

    return {
      sinceRef,
      provenance: "measured",
      diff,
      crossBoundaryEdges,
      newCycles,
      questions: [
        "The graph shows what moved, not whether it should have — is this drift INTENDED, or did something change that shouldn't have?",
        "Removed exports and new cross-boundary edges are the usual culprits — which drift CATEGORY is this (contract / architecture / data-model / permission / behavior)?",
      ],
    };
  } finally {
    fs.rmSync(refDir, { recursive: true, force: true });
  }
}

/** Render a DriftReport as Markdown. */
export function renderDrift(drift: DriftReport): string {
  const lines: string[] = [];
  lines.push(`# Drift since ${drift.sinceRef}`, "");
  if (drift.error) {
    lines.push(`> ${drift.error}`);
    return lines.join("\n");
  }

  const d = drift.diff;
  lines.push(`## Structural changes (${drift.provenance})`, "");
  const section = (title: string, items: string[]) => {
    lines.push(`**${title} (${items.length})**`);
    for (const i of items.slice(0, 15)) lines.push(`- ${i}`);
    if (items.length > 15) lines.push(`- …and ${items.length - 15} more`);
    lines.push("");
  };
  section("Added files", d.addedFiles);
  section("Removed files", d.removedFiles);
  section("Added edges", d.addedEdges);
  section("Removed edges", d.removedEdges);
  section("Added exports", d.addedExports);
  section("Removed exports", d.removedExports);

  if (drift.crossBoundaryEdges.length > 0) {
    lines.push(`**⚠ New cross-boundary edges (${drift.crossBoundaryEdges.length}) — possible architecture drift**`);
    for (const e of drift.crossBoundaryEdges.slice(0, 10)) lines.push(`- ${e}`);
    lines.push("");
  }
  if (drift.newCycles > 0) lines.push(`**⚠ ${drift.newCycles} new dependency cycle(s)**`, "");

  lines.push("## Questions (judgment — the graph cannot answer these)", "");
  for (const q of drift.questions) lines.push(`- ${q}`);

  return lines.join("\n");
}
