import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildOodaPayload } from "../commands/ooda.js";
import {
  sliceFeature,
  generateContextPack,
  saveSlice,
  saveContextPack,
} from "../core/slicer.js";
import { ensureDir } from "../core/utils.js";

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

export function createRepointelServer(): McpServer {
  const server = new McpServer({
    name: "repointel",
    version: "0.4.1",
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
      },
    },
    async ({ root, seeds, name, refresh }) => {
      const repoRoot = root || process.cwd();

      try {
        const payload = await buildOodaPayload(repoRoot, { refresh });

        if (seeds && seeds.length > 0) {
          const sliceName = name || "context";
          const slice = await sliceFeature(seeds, sliceName, { root: repoRoot });

          const slicesDir = path.join(repoRoot, ".repointel", "slices");
          ensureDir(slicesDir);
          const jsonPath = path.join(slicesDir, `${sliceName}.json`);
          const packPath = path.join(slicesDir, `${sliceName}.md`);
          saveSlice(slice, jsonPath);
          saveContextPack(await generateContextPack(slice, repoRoot), packPath);

          (payload as Record<string, unknown>).slice = {
            name: sliceName,
            seedFiles: slice.seedFiles,
            files: slice.files.map((f) => f.relativePath),
            totalFiles: slice.summary.totalFiles,
            totalBytes: slice.summary.totalBytes,
            estimatedTokens: slice.summary.totalTokens,
            excluded: slice.excluded,
            contextPack: path.relative(repoRoot, packPath),
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
