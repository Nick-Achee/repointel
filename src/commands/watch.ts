import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import { generateIndex, saveIndex } from "../core/indexer.js";
import { buildDepGraph } from "../core/dep-graph.js";
import { evaluateContract, type Contract } from "../core/contract.js";
import { readJson } from "../core/utils.js";
import { createDebouncer } from "../core/debounce.js";

export interface WatchCommandOptions {
  contract?: string;
  includeTests?: boolean;
  /** Debounce window in ms (default 150) */
  debounce?: number;
}

const IGNORED = /(^|[/\\])(\.repointel|node_modules|dist|build|\.next|\.git)([/\\]|$)/;

/**
 * Re-index once and print a one-line status. Exported for direct testing.
 */
export async function reindexOnce(
  root: string,
  options: WatchCommandOptions
): Promise<string> {
  const opts = { root, refresh: true, includeTests: options.includeTests };
  const index = await generateIndex(opts);
  saveIndex(index, path.join(root, ".repointel"));
  const graph = await buildDepGraph(opts);

  let status = `${index.summary.totalFiles} files, ${graph.edges.length} edges, ${graph.cycles.length} cycles`;

  if (options.contract) {
    const contract = readJson<Contract>(path.resolve(root, options.contract));
    if (contract && Array.isArray(contract.expect)) {
      const result = evaluateContract(contract, index, graph);
      status += result.ok
        ? ` — ${pc.green("contract OK")}`
        : ` — ${pc.red(`contract FAILED (${result.summary.absent} missing, ${result.summary.violated} violated)`)}`;
    }
  }

  return status;
}

/**
 * Watch the repo and re-index on change. Ambient freshness is already
 * guaranteed by staleness detection on every read; this keeps the index warm
 * and (optionally) re-checks a contract live, as a local gate.
 */
export async function watchCommand(options: WatchCommandOptions): Promise<void> {
  const root = process.cwd();
  const debounceMs = options.debounce ?? 150;

  console.log(pc.cyan("\n👁  repointel watch"));
  console.log(pc.dim(`  ${root}`));
  if (options.contract) console.log(pc.dim(`  contract: ${options.contract}`));

  const stamp = () => new Date().toISOString().slice(11, 19);
  const trigger = createDebouncer(async () => {
    try {
      const status = await reindexOnce(root, options);
      console.log(`  ${pc.dim(stamp())} ${status}`);
    } catch (error) {
      console.error(pc.red(`  reindex failed: ${(error as Error).message}`));
    }
  }, debounceMs);

  // Initial pass.
  console.log(`  ${pc.dim(stamp())} ${await reindexOnce(root, options)}`);

  const onEvent = (_event: string, filename: string | Buffer | null) => {
    const name = typeof filename === "string" ? filename : filename?.toString();
    if (name && IGNORED.test(name)) return;
    if (name && !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) return;
    trigger();
  };

  try {
    // Recursive fs.watch: macOS/Windows always; Linux since Node 20.13.
    const watcher = fs.watch(root, { recursive: true }, onEvent);
    console.log(pc.dim("  watching for changes… (Ctrl-C to stop)\n"));
    process.on("SIGINT", () => {
      watcher.close();
      process.exit(0);
    });
  } catch {
    // Fallback: poll if recursive watch is unavailable on this platform.
    console.log(pc.dim("  (recursive watch unavailable; polling every 1s)\n"));
    setInterval(trigger, 1000);
  }
}
