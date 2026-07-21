import * as path from "node:path";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadRuntime } from "./runtime.js";

const TOOL_DESCRIPTION = `Get deterministic, always-current intelligence about this repository in one call.

Runs the whole pipeline automatically: re-indexes the repo if files changed, traces every
import (including barrel re-exports and tsconfig path aliases) to build the dependency
graph, reads SpecKit feature/task state, and returns ranked next actions.

Call this at the START of any feature/debugging work to orient, and AGAIN after making
changes to see what actually landed. Pass "seeds" (files or directories, e.g. ["src/auth/"])
to also get the context slice for that area: every file reachable through imports.

Returns JSON: observe (file counts, frameworks), orient (features, task progress, graph
stats), decide (ranked actions), artifacts (paths to written files), and slice when seeds
are given.`;

function packageVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)("../../package.json") as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function createRepointelServer(): McpServer {
  const server = new McpServer({
    name: "repointel",
    version: packageVersion(),
  });

  server.registerTool(
    "repo_intel",
    {
      description: TOOL_DESCRIPTION,
      inputSchema: {
        root: z
          .string()
          .optional()
          .describe("Repository root. Defaults to the current working directory."),
        seeds: z
          .array(z.string())
          .optional()
          .describe(
            "Files or directories to slice context from, e.g. ['src/auth/']. " +
              "Directories expand to every file inside them."
          ),
        name: z
          .string()
          .optional()
          .describe("Name for the context slice. Defaults to 'context'."),
        refresh: z
          .boolean()
          .optional()
          .describe("Force a full re-index (staleness is detected automatically)."),
        includeTests: z
          .boolean()
          .optional()
          .describe(
            "Index test/spec files too. Off by default; observe.excludedFromIndex " +
              "always reports how many were left out. Turn on for complete impact analysis."
          ),
        symbol: z
          .string()
          .optional()
          .describe(
            "Narrow impact analysis to one exported name, e.g. 'matchesPattern'. " +
              "Only files that actually import that binding count as directly affected."
          ),
        contract: z
          .string()
          .optional()
          .describe(
            "Path to a contract JSON of expected graph deltas (file-exists, " +
              "export-exists, edge-exists, edge-forbidden). Returns a convergent/" +
              "absent/divergent audit — deterministic verification of intent."
          ),
      },
    },
    async ({ root, seeds, name, refresh, includeTests, symbol, contract }) => {
      const repoRoot = root || process.cwd();

      try {
        // Resolve the implementation per call so a rebuilt bundle is picked
        // up without restarting this long-lived server process.
        const rt = await loadRuntime();

        const payload = await rt.buildOodaPayload(repoRoot, {
          refresh,
          includeTests,
        });

        // Contract audit: deterministic verification of expected graph deltas.
        if (contract) {
          const contractPath = path.isAbsolute(contract)
            ? contract
            : path.join(repoRoot, contract);
          const raw = fs.readFileSync(contractPath, "utf-8");
          const parsed = JSON.parse(raw);
          const index = await rt.generateIndex({ root: repoRoot, includeTests });
          const graph = await rt.buildDepGraph({ root: repoRoot, includeTests });
          (payload as Record<string, unknown>).contract = rt.evaluateContract(
            parsed,
            index,
            graph
          );
        }

        // Freshness is observable rather than assumed: "reloaded" means this
        // call ran the current build, not whatever existed at server spawn.
        (payload as Record<string, unknown>).server = {
          tool: "repo_intel",
          runtime: rt.source,
          buildStamp: rt.buildStamp ?? null,
        };

        if (seeds && seeds.length > 0) {
          const sliceName = name || "context";
          const slice = await rt.sliceFeature(seeds, sliceName, { root: repoRoot });

          const slicesDir = path.join(repoRoot, ".repointel", "slices");
          rt.ensureDir(slicesDir);
          const jsonPath = path.join(slicesDir, `${sliceName}.json`);
          const packPath = path.join(slicesDir, `${sliceName}.md`);
          rt.saveSlice(slice, jsonPath);
          rt.saveContextPack(await rt.generateContextPack(slice, repoRoot), packPath);

          (payload as Record<string, unknown>).slice = {
            name: sliceName,
            seedFiles: slice.seedFiles,
            // Ordered by personalized-PageRank relevance to the seeds.
            files: slice.files.map((f) => f.relativePath),
            ranked: slice.files
              .slice(0, 10)
              .map((f) => ({ file: f.relativePath, rank: f.rank })),
            totalFiles: slice.summary.totalFiles,
            totalBytes: slice.summary.totalBytes,
            estimatedTokens: slice.summary.totalTokens,
            excluded: slice.excluded,
            contextPack: path.relative(repoRoot, packPath),
          };

          // Impact analysis: who breaks if the seeds change (reverse deps)
          const graph = await rt.buildDepGraph({ root: repoRoot, includeTests });
          const impact = rt.findDependents(graph, slice.seedFiles, { symbol });
          (payload as Record<string, unknown>).impact = {
            of: slice.seedFiles,
            symbol: symbol ?? null,
            direct: impact.direct,
            transitive: impact.transitive,
            totalAffected: impact.all.length,
            // Why each file is affected: depth, edge, bindings, import line.
            details: impact.details,
          };
        }

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(payload, null, 2) },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text" as const, text: message }],
        };
      }
    }
  );

  return server;
}
