import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

import { buildOodaPayload } from "../commands/ooda.js";
import {
  sliceFeature,
  generateContextPack,
  saveSlice,
  saveContextPack,
} from "../core/slicer.js";
import { buildDepGraph, findDependents } from "../core/dep-graph.js";
import { ensureDir } from "../core/utils.js";

/** The implementation surface the MCP tool needs. */
export interface Runtime {
  buildOodaPayload: typeof buildOodaPayload;
  sliceFeature: typeof sliceFeature;
  generateContextPack: typeof generateContextPack;
  saveSlice: typeof saveSlice;
  saveContextPack: typeof saveContextPack;
  buildDepGraph: typeof buildDepGraph;
  findDependents: typeof findDependents;
  ensureDir: typeof ensureDir;
  /** Where this implementation came from, for diagnostics */
  source: "bundled" | "reloaded";
  /** Build fingerprint the implementation was loaded from */
  buildStamp?: number;
}

const bundled: Runtime = {
  buildOodaPayload,
  sliceFeature,
  generateContextPack,
  saveSlice,
  saveContextPack,
  buildDepGraph,
  findDependents,
  ensureDir,
  source: "bundled",
};

/**
 * Path of the built library next to this module (dist/index.js when running
 * from dist/mcp/). Null when running from source, e.g. under vitest.
 */
function builtLibraryPath(): URL | null {
  try {
    const url = new URL("../index.js", import.meta.url);
    return fs.existsSync(fileURLToPath(url)) ? url : null;
  } catch {
    return null;
  }
}

let cached: { stamp: number; runtime: Runtime } | null = null;

/**
 * Load the implementation, picking up a rebuilt bundle without restarting.
 *
 * A stdio MCP server is long-lived: it loads its code once at spawn, so a
 * rebuild would otherwise be invisible until the client reconnects. Keying a
 * dynamic import on the build's mtime means an unchanged build reuses the
 * module cache, and a fresh build is imported under a new URL.
 */
export async function loadRuntime(): Promise<Runtime> {
  const libUrl = builtLibraryPath();
  if (!libUrl) return bundled;

  let stamp: number;
  try {
    stamp = fs.statSync(fileURLToPath(libUrl)).mtimeMs;
  } catch {
    return bundled;
  }

  if (cached && cached.stamp === stamp) return cached.runtime;

  try {
    // The specifier is computed, so bundlers leave it as a runtime import.
    const fresh = (await import(
      `${libUrl.href}?build=${stamp}`
    )) as Partial<Runtime>;

    // Only accept a reload that provides the whole surface.
    const required: Array<keyof Runtime> = [
      "buildOodaPayload",
      "sliceFeature",
      "generateContextPack",
      "saveSlice",
      "saveContextPack",
      "buildDepGraph",
      "findDependents",
      "ensureDir",
    ];
    if (required.some((key) => typeof fresh[key] !== "function")) {
      return bundled;
    }

    const runtime: Runtime = {
      ...(fresh as Omit<Runtime, "source" | "buildStamp">),
      source: "reloaded",
      buildStamp: stamp,
    };
    cached = { stamp, runtime };
    return runtime;
  } catch {
    // A half-written bundle mid-rebuild must not take the server down.
    return bundled;
  }
}
