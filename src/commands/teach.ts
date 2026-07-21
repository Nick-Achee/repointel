import pc from "picocolors";
import * as path from "node:path";
import { generateIndex } from "../core/indexer.js";
import { buildDepGraph } from "../core/dep-graph.js";
import { derivePolicy } from "../core/policy.js";
import { writeJson } from "../core/utils.js";

export interface TeachInitOptions {
  root?: string;
}

export async function teachInit(options: TeachInitOptions = {}): Promise<void> {
  const root = options.root || process.cwd();
  const index = await generateIndex({ root });
  const graph = await buildDepGraph({ root });
  const policy = derivePolicy(index, graph);

  const out = path.join(root, ".repointel", "architecture.json");
  writeJson(out, policy);

  console.log(pc.green(`\n  ✓ Derived policy: ${policy.labels.length} labels, ${policy.forbidden.length} candidate rules`));
  console.log(pc.dim("    All labels are 'inferred' and all rules 'ratified:false'."));
  console.log(pc.dim("    Review .repointel/architecture.json:"));
  console.log(pc.dim("      - promote a label's provenance to 'declared' to let its rules gate CI"));
  console.log(pc.dim("      - set a rule's 'ratified' to true to enforce it"));
  console.log(`\n  → ${pc.cyan(path.relative(root, out))}\n`);
}
