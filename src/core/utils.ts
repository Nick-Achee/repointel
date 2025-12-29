import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";

/**
 * Get git commit hash for current repo
 */
export function getGitCommit(repoRoot: string): string | undefined {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

/**
 * Get current git branch
 */
export function getGitBranch(repoRoot: string): string | undefined {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

/**
 * Compute file hash (first 8 chars of sha256)
 */
export function hashFile(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 8);
}

/**
 * Read file safely, return null if not found
 */
export function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Get file size safely
 */
export function getFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Ensure directory exists
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Write JSON to file with pretty printing
 */
export function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Read JSON from file
 */
export function readJson<T>(filePath: string): T | null {
  const content = readFileSafe(filePath);
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Count pattern occurrences in text
 */
export function countPattern(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Convert Next.js file path to route path
 */
export function filePathToRoutePath(filePath: string): string {
  let routePath = filePath
    // Remove src/app or app prefix
    .replace(/^src\/app/, "")
    .replace(/^app/, "")
    // Remove file suffixes
    .replace(/\/page\.(tsx?|jsx?|js)$/, "")
    .replace(/\/route\.(tsx?|jsx?|js)$/, "")
    .replace(/\/layout\.(tsx?|jsx?|js)$/, "")
    .replace(/\/loading\.(tsx?|jsx?|js)$/, "")
    .replace(/\/error\.(tsx?|jsx?|js)$/, "")
    .replace(/\/not-found\.(tsx?|jsx?|js)$/, "")
    // Remove route groups like (public)/
    .replace(/\(([^)]+)\)\//g, "");

  if (!routePath || routePath === "") {
    routePath = "/";
  }
  if (!routePath.startsWith("/")) {
    routePath = "/" + routePath;
  }
  return routePath;
}

/**
 * Check if path is dynamic route segment
 */
export function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

/**
 * Extract route params from path
 */
export function extractRouteParams(routePath: string): string[] {
  const params: string[] = [];
  const segments = routePath.split("/");
  for (const segment of segments) {
    if (isDynamicSegment(segment)) {
      // Remove brackets and ... prefix
      const param = segment.slice(1, -1).replace(/^\.\.\./, "");
      params.push(param);
    }
  }
  return params;
}

/**
 * Simple glob pattern matching
 */
export function matchesPattern(filePath: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\*\*/g, "{{DOUBLESTAR}}")
        .replace(/\*/g, "[^/]*")
        .replace(/{{DOUBLESTAR}}/g, ".*")
        .replace(/\./g, "\\.") +
      "$"
  );
  return regex.test(filePath);
}

/**
 * Check if file matches any of the patterns
 */
export function matchesPatterns(filePath: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(filePath, p));
}
