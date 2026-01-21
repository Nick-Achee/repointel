import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const TEST_OUTPUT_DIR = path.join(process.cwd(), ".repointel-test");
const DIAGRAMS_DIR = path.join(TEST_OUTPUT_DIR, "diagrams");
const SLICES_DIR = path.join(TEST_OUTPUT_DIR, "slices");

// Helper to run CLI command
function runCli(args: string): string {
  try {
    return execSync(`node dist/bin/cli.js ${args}`, {
      encoding: "utf-8",
      cwd: process.cwd(),
    });
  } catch (error: any) {
    return error.stdout || error.stderr || error.message;
  }
}

// Helper to clean test output
function cleanTestOutput() {
  if (fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.rmSync(TEST_OUTPUT_DIR, { recursive: true });
  }
}

describe("viz command integration", () => {
  beforeAll(() => {
    cleanTestOutput();
  });

  afterAll(() => {
    cleanTestOutput();
  });

  it("generates all 4 diagram types with --seeds", () => {
    const output = runCli(`viz --seeds src/core/utils.ts --output ${DIAGRAMS_DIR}`);

    expect(output).toContain("Generating visualizations");
    expect(output).toContain("VISUALIZATION SUMMARY");

    // Check all 4 diagram files exist
    const files = fs.readdirSync(DIAGRAMS_DIR);
    expect(files).toContain("feature_dataflow.mmd");
    expect(files).toContain("feature_architecture.mmd");
    expect(files).toContain("feature_sequence.mmd");
    expect(files).toContain("feature_components.mmd");
  });

  it("generates only dataflow diagram with --diagram dataflow", () => {
    const subDir = path.join(DIAGRAMS_DIR, "single");
    const output = runCli(`viz --seeds src/core/utils.ts --diagram dataflow --output ${subDir}`);

    expect(output).toContain("Diagram: dataflow");

    const files = fs.readdirSync(subDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe("feature_dataflow.mmd");
  });

  it("generates valid mermaid syntax", () => {
    const output = runCli(`viz --seeds src/core/utils.ts --output ${DIAGRAMS_DIR}`);

    const dataflowPath = path.join(DIAGRAMS_DIR, "feature_dataflow.mmd");
    const content = fs.readFileSync(dataflowPath, "utf-8");

    // Check it's valid mermaid
    expect(content).toMatch(/^graph (TD|LR|BT|RL)/);
    expect(content).toContain("subgraph");
    expect(content).toContain("classDef");
  });

  it("supports --direction LR option", () => {
    const subDir = path.join(DIAGRAMS_DIR, "lr");
    const output = runCli(`viz --seeds src/core/utils.ts --direction LR --output ${subDir}`);

    expect(output).toContain("Direction: LR");

    const dataflowPath = path.join(subDir, "feature_dataflow.mmd");
    const content = fs.readFileSync(dataflowPath, "utf-8");
    expect(content).toContain("graph LR");
  });

  it("uses custom name with --name option", () => {
    const subDir = path.join(DIAGRAMS_DIR, "named");
    runCli(`viz --seeds src/core/utils.ts --name my-feature --output ${subDir}`);

    const files = fs.readdirSync(subDir);
    expect(files.some((f) => f.startsWith("my-feature_"))).toBe(true);
  });

  it("shows layer breakdown in summary", () => {
    const output = runCli(`viz --seeds src/core/visualizer.ts --output ${DIAGRAMS_DIR}`);

    expect(output).toContain("Layers:");
    expect(output).toContain("UI:");
    expect(output).toContain("Logic:");
    expect(output).toContain("API:");
    expect(output).toContain("Data:");
  });

  it("shows data flow edge types", () => {
    const output = runCli(`viz --seeds src/core/visualizer.ts --output ${DIAGRAMS_DIR}`);

    // The visualizer has example API calls in comments that get detected
    expect(output).toContain("Data Flows:");
  });
});

describe("slice --viz integration", () => {
  beforeAll(() => {
    cleanTestOutput();
  });

  afterAll(() => {
    cleanTestOutput();
  });

  it("includes diagrams in markdown output", () => {
    const output = runCli(`slice --seeds src/core/utils.ts --viz --output ${SLICES_DIR}`);

    expect(output).toContain("Generating visualizations");

    const mdPath = path.join(SLICES_DIR, "feature.md");
    const content = fs.readFileSync(mdPath, "utf-8");

    expect(content).toContain("## Architecture Diagrams");
    expect(content).toContain("```mermaid");
    expect(content).toContain("graph TD");
  });

  it("includes all diagram sections in markdown", () => {
    runCli(`slice --seeds src/core/utils.ts --viz --name diagrams-test --output ${SLICES_DIR}`);

    const mdPath = path.join(SLICES_DIR, "diagrams-test.md");
    const content = fs.readFileSync(mdPath, "utf-8");

    expect(content).toContain("### Data Flow");
    expect(content).toContain("### Architecture Layers");
    expect(content).toContain("### Component Dependencies");
  });

  it("does not include diagrams without --viz flag", () => {
    runCli(`slice --seeds src/core/utils.ts --name no-viz --output ${SLICES_DIR}`);

    const mdPath = path.join(SLICES_DIR, "no-viz.md");
    const content = fs.readFileSync(mdPath, "utf-8");

    expect(content).not.toContain("## Architecture Diagrams");
    expect(content).not.toContain("```mermaid");
  });
});

describe("output file structure", () => {
  beforeAll(() => {
    cleanTestOutput();
  });

  afterAll(() => {
    cleanTestOutput();
  });

  it("saves diagrams to specified output directory", () => {
    const customDir = path.join(TEST_OUTPUT_DIR, "custom-diagrams");
    runCli(`viz --seeds src/core/utils.ts --output ${customDir}`);

    expect(fs.existsSync(customDir)).toBe(true);
    const files = fs.readdirSync(customDir);
    expect(files.length).toBeGreaterThan(0);
  });

  it("creates output directory if it doesn't exist", () => {
    const newDir = path.join(TEST_OUTPUT_DIR, "new", "nested", "dir");
    runCli(`viz --seeds src/core/utils.ts --output ${newDir}`);

    expect(fs.existsSync(newDir)).toBe(true);
  });
});
