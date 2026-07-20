import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRepointelServer } from "./server.js";

let repoRoot: string;
let client: Client;

async function connectClient() {
  const server = createRepointelServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    c.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return c;
}

function callResult(result: any) {
  const text = result.content.find((c: any) => c.type === "text")?.text ?? "";
  return JSON.parse(text);
}

beforeAll(async () => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-mcp-"));
  fs.mkdirSync(path.join(repoRoot, "src", "auth"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "src/auth/login.ts"),
    'import { db } from "../db";\nexport const login = db;'
  );
  fs.writeFileSync(path.join(repoRoot, "src/db.ts"), "export const db = 1;");

  const featureDir = path.join(repoRoot, ".specify", "specs", "001-auth");
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, "tasks.md"),
    ["# Tasks", "- [x] Scaffold", "- [~] Build login", "- [ ] Wire mailer"].join("\n")
  );

  client = await connectClient();
});

afterAll(async () => {
  await client.close();
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("repointel MCP server", () => {
  it("exposes a single repo_intel tool", async () => {
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("repo_intel");
    expect(tools[0].description).toBeTruthy();
  });

  it("runs the whole pipeline from one call with no arguments beyond root", async () => {
    const result = await client.callTool({
      name: "repo_intel",
      arguments: { root: repoRoot },
    });
    const payload = callResult(result);

    expect(payload.observe.files).toBeGreaterThan(0);
    expect(payload.orient.graph.nodes).toBeGreaterThan(0);
    expect(payload.orient.currentFeature.id).toBe("001-auth");
    expect(payload.orient.currentFeature.tasks.inProgress).toBe(1);
    expect(payload.decide.actions.length).toBeGreaterThan(0);
  });

  it("returns a context slice when seeds are supplied", async () => {
    const result = await client.callTool({
      name: "repo_intel",
      arguments: { root: repoRoot, seeds: ["src/auth/"] },
    });
    const payload = callResult(result);

    expect(payload.slice.files).toContain("src/auth/login.ts");
    expect(payload.slice.files).toContain("src/db.ts");
    expect(payload.slice.contextPack).toMatch(/\.repointel\/slices\/.*\.md$/);
  });

  it("answers 'what is this project' with identity from package.json and README", async () => {
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "acme-auth",
        version: "2.1.0",
        description: "Authentication service for Acme",
        bin: { "acme-auth": "dist/cli.js" },
      })
    );
    fs.writeFileSync(
      path.join(repoRoot, "README.md"),
      "# acme-auth\n\n> Handles login, sessions, and password reset.\n\n## Install\n"
    );

    const result = await client.callTool({
      name: "repo_intel",
      arguments: { root: repoRoot, refresh: true },
    });
    const payload = callResult(result);

    expect(payload.project.name).toBe("acme-auth");
    expect(payload.project.version).toBe("2.1.0");
    expect(payload.project.description).toBe("Authentication service for Acme");
    expect(payload.project.readme).toMatch(/login, sessions/);
  });

  it("reports real working-tree state so recommendations reflect reality", async () => {
    const result = await client.callTool({
      name: "repo_intel",
      arguments: { root: repoRoot },
    });
    const payload = callResult(result);

    expect(payload.git).toBeDefined();
    expect(payload.git).toHaveProperty("isRepo");
    expect(payload.git).toHaveProperty("uncommittedFiles");
  });

  it("returns impact analysis (who imports the seeds) alongside the slice", async () => {
    const result = await client.callTool({
      name: "repo_intel",
      arguments: { root: repoRoot, seeds: ["src/db.ts"], name: "impact" },
    });
    const payload = callResult(result);

    expect(payload.impact.direct).toContain("src/auth/login.ts");
    expect(payload.impact.totalAffected).toBeGreaterThan(0);
  });

  it("reports an unusable seed as an error result instead of throwing", async () => {
    const result: any = await client.callTool({
      name: "repo_intel",
      arguments: { root: repoRoot, seeds: ["src/does-not-exist.ts"] },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/seed/i);
  });
});
