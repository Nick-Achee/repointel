import { describe, it, expect } from "vitest";
import { matchesPattern } from "./utils.js";

describe("matchesPattern", () => {
  it("matches nested files with a **/ prefix", () => {
    expect(
      matchesPattern("src/components/Button.stories.tsx", "**/*.stories.tsx")
    ).toBe(true);
  });

  it("matches root-level files with a **/ prefix", () => {
    expect(matchesPattern("Button.stories.tsx", "**/*.stories.tsx")).toBe(true);
  });

  it("matches paths containing a ** directory wildcard", () => {
    expect(
      matchesPattern("a/b/node_modules/pkg/file.js", "**/node_modules/**")
    ).toBe(true);
  });

  it("treats bracket segments as literals (Next.js dynamic routes)", () => {
    expect(matchesPattern("app/[id]/page.tsx", "app/[id]/page.tsx")).toBe(true);
  });

  it("does not let a single star cross directory boundaries", () => {
    expect(matchesPattern("src/deep/file.ts", "src/*.ts")).toBe(false);
  });

  it("still matches simple single-star patterns", () => {
    expect(matchesPattern("src/file.ts", "src/*.ts")).toBe(true);
  });
});
