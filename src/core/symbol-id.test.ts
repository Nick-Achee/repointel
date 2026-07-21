import { describe, it, expect } from "vitest";
import { scipSymbol, classifyExports } from "./symbol-id.js";

describe("scipSymbol", () => {
  const id = (name: string, kind: Parameters<typeof scipSymbol>[3]) =>
    scipSymbol({ name: "repointel", version: "0.4.1" }, "src/core/utils.ts", name, kind);

  it("encodes a term/const with a trailing dot descriptor", () => {
    expect(id("MAX_SIZE", "term")).toBe(
      "repointel 0.4.1 src/core/utils.ts/MAX_SIZE."
    );
  });

  it("encodes a function as a method descriptor", () => {
    expect(id("matchesPattern", "function")).toBe(
      "repointel 0.4.1 src/core/utils.ts/matchesPattern()."
    );
  });

  it("encodes a type/class/interface with a hash descriptor", () => {
    expect(id("GitState", "type")).toBe(
      "repointel 0.4.1 src/core/utils.ts/GitState#"
    );
  });

  it("is stable: same inputs always produce the same id (diffable across runs)", () => {
    expect(id("matchesPattern", "function")).toBe(id("matchesPattern", "function"));
  });

  it("uses '.' as the local package version when none is given", () => {
    expect(
      scipSymbol({ name: "app" }, "a.ts", "x", "term")
    ).toBe("app . a.ts/x.");
  });

  it("normalizes windows path separators so ids match across platforms", () => {
    expect(
      scipSymbol({ name: "p", version: "1" }, "src\\core\\utils.ts", "x", "term")
    ).toBe("p 1 src/core/utils.ts/x.");
  });
});

describe("classifyExports", () => {
  it("assigns a SCIP kind to each exported declaration", () => {
    const content = [
      "export const MAX = 1;",
      "export function run() {}",
      "export class Engine {}",
      "export interface Opts {}",
      "export type Id = string;",
      "export default function () {}",
    ].join("\n");

    const kinds = classifyExports(content);
    expect(kinds.MAX).toBe("term");
    expect(kinds.run).toBe("function");
    expect(kinds.Engine).toBe("type");
    expect(kinds.Opts).toBe("type");
    expect(kinds.Id).toBe("type");
  });
});
