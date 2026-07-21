import { describe, it, expect } from "vitest";
import { resolveLabels, type ArchitecturePolicy } from "./policy.js";

const POLICY: ArchitecturePolicy = {
  version: "1.0.0",
  labels: [
    { label: "core", include: ["src/core/**"], provenance: "declared" },
    { label: "cli", include: ["src/commands/**", "src/bin/**"], provenance: "declared" },
  ],
  forbidden: [],
  entrypoints: [],
};

describe("resolveLabels", () => {
  it("maps each file to its label and reports unlabeled files", () => {
    const files = ["src/core/utils.ts", "src/commands/scan.ts", "src/bin/cli.ts", "src/rogue.ts"];
    const { labelOf, unlabeled } = resolveLabels(POLICY, files);

    expect(labelOf.get("src/core/utils.ts")).toBe("core");
    expect(labelOf.get("src/commands/scan.ts")).toBe("cli");
    expect(labelOf.get("src/bin/cli.ts")).toBe("cli");
    expect(unlabeled).toEqual(["src/rogue.ts"]);
  });
});
