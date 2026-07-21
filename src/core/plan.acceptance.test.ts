import { describe, it, expect } from "vitest";
import { buildPlan, renderPlan } from "./plan.js";

const ROOT = process.cwd();

describe("plan on repointel itself", () => {
  it("grounds Observe/Decide in the real graph and asks judgment questions", async () => {
    const plan = await buildPlan("add rename detection", ["src/core/indexer.ts"], {
      root: ROOT,
    });

    // Observe: the seed is present and the slice is ranked/non-empty.
    expect(plan.observe.seedFiles).toContain("src/core/indexer.ts");
    expect(plan.observe.files.length).toBeGreaterThan(1);

    // Decide: indexer.ts is central, so many files are affected.
    expect(plan.decide.impact.affected.length).toBeGreaterThan(3);
    expect(plan.decide.guard).toHaveProperty("ok");

    // Judgment is never asserted as fact — it is asked.
    expect(plan.orient.questions.length).toBeGreaterThan(0);
    expect(plan.decide.questions.length).toBeGreaterThan(0);

    // The rendered document is coherent and discloses provenance.
    const md = renderPlan(plan);
    expect(md).toMatch(/measured/);
    expect(md).toMatch(/## 4\. Act/);
  });
});
