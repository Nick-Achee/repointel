import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateIndex } from "./indexer.js";

let cliRoot: string;
let reactRoot: string;

function write(root: string, rel: string, content: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeAll(() => {
  cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-cli-"));
  write(
    cliRoot,
    "package.json",
    JSON.stringify({ name: "toolcli", dependencies: { commander: "^12.0.0" } })
  );
  write(cliRoot, "src/bin/cli.ts", "export const run = 1;");
  write(cliRoot, "src/commands/scan.ts", "export const scan = 1;");
  write(cliRoot, "src/core/utils.ts", "export const util = 1;");

  reactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-react-"));
  write(
    reactRoot,
    "package.json",
    JSON.stringify({ name: "web", dependencies: { react: "^18.0.0" } })
  );
  write(
    reactRoot,
    "src/Counter.tsx",
    'import { useState } from "react";\nexport const C = () => useState(0);'
  );
});

afterAll(() => {
  fs.rmSync(cliRoot, { recursive: true, force: true });
  fs.rmSync(reactRoot, { recursive: true, force: true });
});

describe("file type taxonomy", () => {
  it("classifies CLI entry points and commands as cli, not api", async () => {
    const index = await generateIndex({ root: cliRoot });
    const typeOf = (p: string) =>
      index.files.find((f) => f.relativePath === p)?.type;

    expect(typeOf("src/bin/cli.ts")).toBe("cli");
    expect(typeOf("src/commands/scan.ts")).toBe("cli");
  });

  it("classifies an MCP server surface as api, not a UI component", async () => {
    write(cliRoot, "src/mcp/server.ts", "export const server = 1;");

    const index = await generateIndex({ root: cliRoot, refresh: true });
    const mcp = index.files.find((f) => f.relativePath === "src/mcp/server.ts");

    expect(mcp?.type).toBe("api");
  });
});

describe("React metric suppression", () => {
  it("omits React metrics for a project with no React dependency", async () => {
    const index = await generateIndex({ root: cliRoot });

    expect(index.summary.totalHooks).toBeUndefined();
    expect(index.summary.clientComponents).toBeUndefined();
    expect(index.summary.totalAntiPatterns).toBeUndefined();
  });

  it("still reports React metrics for a React project", async () => {
    const index = await generateIndex({ root: reactRoot });

    expect(index.summary.totalHooks).toBeDefined();
    expect(index.summary.totalHooks?.useState).toBe(1);
  });
});

describe("export extraction", () => {
  it("records the public (post-`as`) name of an aliased export", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-alias-exp-"));
    try {
      write(root, "package.json", JSON.stringify({ name: "p", version: "1" }));
      write(
        root,
        "src/mod.ts",
        "function internalApi() {}\nexport { internalApi as PublicApi };"
      );

      const index = await generateIndex({ root });
      const exp = index.files.find((f) => f.relativePath === "src/mod.ts")!.exports;

      expect(exp).toContain("PublicApi");
      expect(exp).not.toContain("internalApi");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("records the namespace name of `export * as ns`", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-star-ns-"));
    try {
      write(root, "package.json", JSON.stringify({ name: "p", version: "1" }));
      write(root, "src/icons.ts", "export const Icon = 1;");
      write(root, "src/index.ts", 'export * as icons from "./icons";');

      const index = await generateIndex({ root });
      const exp = index.files.find((f) => f.relativePath === "src/index.ts")!.exports;

      expect(exp).toContain("icons");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("forwards a bare `export * from` barrel's re-exported names", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-star-barrel-"));
    try {
      write(root, "package.json", JSON.stringify({ name: "p", version: "1" }));
      write(root, "src/lib/mailer.ts", "export function send() {}\nexport function receive() {}");
      write(root, "src/lib/index.ts", 'export * from "./mailer";');

      const index = await generateIndex({ root });
      const barrel = index.files.find((f) => f.relativePath === "src/lib/index.ts")!;

      expect(barrel.exports).toContain("send");
      expect(barrel.exports).toContain("receive");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("stable symbol ids", () => {
  it("attaches a SCIP-style id and kind to each exported symbol", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-sym-"));
    try {
      write(
        root,
        "package.json",
        JSON.stringify({ name: "toolcli", version: "1.2.3" })
      );
      write(
        root,
        "src/util.ts",
        "export function matchesPattern() {}\nexport const MAX = 1;\nexport type Id = string;"
      );

      const index = await generateIndex({ root });
      const file = index.files.find((f) => f.relativePath === "src/util.ts");
      const byName = new Map(file?.symbols?.map((s) => [s.name, s]));

      expect(byName.get("matchesPattern")?.id).toBe(
        "toolcli 1.2.3 src/util.ts/matchesPattern()."
      );
      expect(byName.get("MAX")?.kind).toBe("term");
      expect(byName.get("Id")?.kind).toBe("type");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("provenance", () => {
  it("labels measured facts and inferred guesses so they cannot be confused", async () => {
    const index = await generateIndex({ root: cliRoot });

    expect(index.provenance?.measured).toContain("files");
    expect(index.provenance?.inferred).toHaveProperty("byType");
    expect(index.provenance?.inferred.byType).toMatch(/heuristic|path/i);
  });
});
