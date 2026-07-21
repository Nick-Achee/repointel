import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import {
  evaluateContract,
  snapshotGraph,
  diffSnapshots,
  deriveContractFromDiff,
  type Contract,
} from "./contract.js";

let root: string;

function w(rel: string, content: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-contract-"));
  w("package.json", JSON.stringify({ name: "app", version: "1.0.0" }));
  w("src/auth/reset.ts", 'import { send } from "../lib/mailer";\nexport function resetPassword() { return send(); }');
  w("src/lib/mailer.ts", "export function send() {}");
  w("src/ui/page.ts", 'import { resetPassword } from "../auth/reset";\nexport const page = resetPassword;');
  w("src/db/secret.ts", "export const secret = 1;");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function graphAndIndex() {
  const index = await generateIndex({ root });
  const graph = await buildDepGraph({ root });
  return { index, graph };
}

describe("evaluateContract", () => {
  it("marks satisfied expectations convergent", async () => {
    const { index, graph } = await graphAndIndex();
    const contract: Contract = {
      name: "reset",
      expect: [
        { kind: "file-exists", path: "src/auth/reset.ts" },
        { kind: "export-exists", file: "src/auth/reset.ts", symbol: "resetPassword" },
        { kind: "edge-exists", from: "src/auth/reset.ts", to: "src/lib/mailer.ts" },
      ],
    };

    const result = evaluateContract(contract, index, graph);
    expect(result.ok).toBe(true);
    expect(result.summary.satisfied).toBe(3);
    expect(result.results.every((r) => r.classification === "convergent")).toBe(true);
  });

  it("marks a missing promised delta absent, failing the contract", async () => {
    const { index, graph } = await graphAndIndex();
    const contract: Contract = {
      name: "reset",
      expect: [
        { kind: "export-exists", file: "src/auth/reset.ts", symbol: "resetPassword" },
        { kind: "file-exists", path: "src/auth/confirm.ts" }, // never created
        { kind: "edge-exists", from: "src/auth/reset.ts", to: "src/lib/sms.ts" }, // no such edge
      ],
    };

    const result = evaluateContract(contract, index, graph);
    expect(result.ok).toBe(false);
    expect(result.summary.absent).toBe(2);
    const absent = result.results.filter((r) => r.classification === "absent");
    expect(absent.map((r) => (r.expectation as { path?: string }).path)).toContain(
      "src/auth/confirm.ts"
    );
  });

  it("flags a forbidden edge that exists as divergent", async () => {
    const { index, graph } = await graphAndIndex();
    // UI must not import the db layer directly; page.ts does not, but let's
    // forbid ui->auth which DOES exist to prove violation detection.
    const contract: Contract = {
      name: "boundaries",
      expect: [
        { kind: "edge-forbidden", from: "src/ui/**", to: "src/auth/**" },
        { kind: "edge-forbidden", from: "src/ui/**", to: "src/db/**" }, // holds
      ],
    };

    const result = evaluateContract(contract, index, graph);
    expect(result.ok).toBe(false);
    expect(result.summary.violated).toBe(1);
    const violation = result.results.find((r) => r.classification === "divergent");
    expect(violation?.matches).toContain("src/ui/page.ts -> src/auth/reset.ts");
  });
});

describe("snapshot + diff", () => {
  it("reports files, edges, and exports that appeared between two snapshots", async () => {
    const before = snapshotGraph(
      await buildDepGraph({ root }),
      await generateIndex({ root })
    );

    // Add a new file with a new edge and export.
    w("src/auth/confirm.ts", 'import { send } from "../lib/mailer";\nexport function confirm() { return send(); }');

    const after = snapshotGraph(
      await buildDepGraph({ root, includeTests: true }),
      await generateIndex({ root, refresh: true })
    );

    const diff = diffSnapshots(before, after);
    expect(diff.addedFiles).toContain("src/auth/confirm.ts");
    expect(diff.addedEdges).toContain("src/auth/confirm.ts -> src/lib/mailer.ts");
    expect(diff.addedExports.some((e) => e.includes("confirm"))).toBe(true);

    fs.rmSync(path.join(root, "src/auth/confirm.ts"));
  });
});

describe("deriveContractFromDiff", () => {
  it("turns observed additions into an expected-delta contract", async () => {
    const before = snapshotGraph(
      await buildDepGraph({ root }),
      await generateIndex({ root, refresh: true })
    );
    w("src/feature/new.ts", 'import { send } from "../lib/mailer";\nexport const feature = send;');
    const after = snapshotGraph(
      await buildDepGraph({ root }),
      await generateIndex({ root, refresh: true })
    );

    const contract = deriveContractFromDiff("new-feature", diffSnapshots(before, after));
    const kinds = contract.expect.map((e) => e.kind);
    expect(kinds).toContain("file-exists");
    expect(kinds).toContain("edge-exists");
    // The derived contract must pass against the state it was derived from.
    const result = evaluateContract(
      contract,
      await generateIndex({ root, refresh: true }),
      await buildDepGraph({ root })
    );
    expect(result.ok).toBe(true);

    fs.rmSync(path.join(root, "src/feature/new.ts"), { force: true });
    fs.rmSync(path.join(root, "src/feature"), { recursive: true, force: true });
  });
});

describe("evaluateContract robustness", () => {
  it("does not throw on an unknown expectation kind", async () => {
    const { index, graph } = await graphAndIndex();
    const contract = {
      name: "malformed",
      expect: [{ kind: "edge-banned", from: "a", to: "b" } as never],
    };
    expect(() => evaluateContract(contract, index, graph)).not.toThrow();
    const result = evaluateContract(contract, index, graph);
    expect(result.ok).toBe(false);
    expect(result.results[0].classification).toBe("absent");
  });
});

describe("path-forbidden expectation", () => {
  it("is divergent when the target is reachable transitively, convergent when not", async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-pf-"));
    try {
      const w = (rel: string, c: string) => {
        const abs = path.join(r, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, c);
      };
      w("package.json", JSON.stringify({ name: "p", version: "1" }));
      // ui -> service -> db  (ui reaches db only transitively)
      w("src/ui/page.ts", 'import { s } from "../service/s";\nexport const p = s;');
      w("src/service/s.ts", 'import { d } from "../db/d";\nexport const s = d;');
      w("src/db/d.ts", "export const d = 1;");
      w("src/lonely/x.ts", "export const x = 1;");

      const index = await generateIndex({ root: r });
      const graph = await buildDepGraph({ root: r });

      const forbidden = evaluateContract(
        { name: "t", expect: [{ kind: "path-forbidden", from: "src/ui/**", to: "src/db/**" }] },
        index, graph
      );
      expect(forbidden.results[0].classification).toBe("divergent");

      const allowed = evaluateContract(
        { name: "t", expect: [{ kind: "path-forbidden", from: "src/lonely/**", to: "src/db/**" }] },
        index, graph
      );
      expect(allowed.results[0].classification).toBe("convergent");
    } finally {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });
});
