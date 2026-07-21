import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildPlan } from "./plan.js";
import { renderPlan } from "./plan.js";

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-plan-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  w("src/auth/login.ts", 'import { db } from "../core/db";\nexport function login() { return db; }');
  w("src/core/db.ts", "export const db = 1;");
  w("src/ui/page.ts", 'import { login } from "../auth/login";\nexport const page = login;');
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("buildPlan", () => {
  it("fills Observe from the ranked seed slice with file evidence", async () => {
    const plan = await buildPlan("add password reset", ["src/auth/"], { root });

    expect(plan.goal).toBe("add password reset");
    expect(plan.observe.seedFiles).toContain("src/auth/login.ts");
    expect(plan.observe.files.length).toBeGreaterThan(0);
    expect(plan.observe.files[0]).toHaveProperty("relativePath");
    expect(plan.provenance.observe).toBe("measured");
  });

  it("fills Orient with inferred boundaries and routes volatility to a question", async () => {
    const plan = await buildPlan("add password reset", ["src/auth/"], { root });

    expect(plan.orient.boundaries.map((b) => b.label)).toContain("auth");
    expect(plan.orient.boundaries[0]).toHaveProperty("instability");
    expect(plan.orient.questions.join(" ")).toMatch(/volatil|change/i);
    expect(plan.provenance.orient).toBe("inferred");
  });

  it("fills Decide with the guard report and impact of the seeds", async () => {
    const plan = await buildPlan("add password reset", ["src/auth/"], { root });

    expect(plan.decide.guard).toHaveProperty("ok");
    expect(plan.decide.impact.affected).toContain("src/ui/page.ts");
  });

  it("emits an Act contract skeleton of expected deltas as questions, not assertions", async () => {
    const plan = await buildPlan("add password reset", ["src/auth/"], { root });

    expect(plan.act.contractTemplate.name).toBeTruthy();
    expect(Array.isArray(plan.act.contractTemplate.expect)).toBe(true);
    expect(plan.act.note).toMatch(/complete|fill|expected/i);
  });

  it("marks judgment sections as questions, never asserts them", async () => {
    const plan = await buildPlan("add password reset", ["src/auth/"], { root });

    const allQuestions = [
      ...plan.orient.questions,
      ...plan.decide.questions,
    ].join(" ");
    expect(allQuestions).toMatch(/primitive|pattern|invariant/i);
  });
});

describe("renderPlan", () => {
  it("renders the SOP sections with evidence and questions, marking provenance", async () => {
    const plan = await buildPlan("add password reset", ["src/auth/"], { root });
    const md = renderPlan(plan);

    expect(md).toMatch(/# Feature Plan/);
    expect(md).toMatch(/## 1\. Observe/);
    expect(md).toMatch(/## 2\. Orient/);
    expect(md).toMatch(/## 3\. Decide/);
    expect(md).toMatch(/## 4\. Act/);
    expect(md).toContain("src/auth/login.ts");
    expect(md).toMatch(/\?\s*$/m);
    expect(md).toMatch(/measured|inferred/);
    expect(md).toMatch(/```json[\s\S]*file-exists/);
  });
});
