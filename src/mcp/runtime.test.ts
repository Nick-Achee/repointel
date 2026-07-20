import { describe, it, expect } from "vitest";
import { loadRuntime } from "./runtime.js";

describe("loadRuntime", () => {
  it("provides the whole implementation surface", async () => {
    const rt = await loadRuntime();

    for (const fn of [
      "buildOodaPayload",
      "sliceFeature",
      "generateContextPack",
      "saveSlice",
      "saveContextPack",
      "buildDepGraph",
      "findDependents",
      "ensureDir",
    ] as const) {
      expect(typeof rt[fn]).toBe("function");
    }
  });

  it("falls back to the bundled implementation when no build is present", async () => {
    // Running from source under vitest, there is no sibling dist/index.js.
    const rt = await loadRuntime();
    expect(rt.source).toBe("bundled");
  });
});
