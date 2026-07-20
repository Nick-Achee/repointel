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

describe("provenance", () => {
  it("labels measured facts and inferred guesses so they cannot be confused", async () => {
    const index = await generateIndex({ root: cliRoot });

    expect(index.provenance?.measured).toContain("files");
    expect(index.provenance?.inferred).toHaveProperty("byType");
    expect(index.provenance?.inferred.byType).toMatch(/heuristic|path/i);
  });
});
