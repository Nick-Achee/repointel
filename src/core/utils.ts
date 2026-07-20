import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync, execFileSync } from "node:child_process";

/**
 * Run a git command without a shell (arguments are passed as an array, so no
 * shell interpolation is possible). Returns null when git fails or is absent.
 */
function git(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();
  } catch {
    return null;
  }
}

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

export interface GitState {
  isRepo: boolean;
  branch?: string;
  head?: string;
  uncommittedFiles: string[];
  untrackedFiles: string[];
  recentCommits: string[];
}

/**
 * Read the working-tree state: what has actually changed, not what a spec claims.
 */
export function getGitState(repoRoot: string): GitState {
  const status = git(repoRoot, ["status", "--porcelain"]);
  if (status === null) {
    return {
      isRepo: false,
      uncommittedFiles: [],
      untrackedFiles: [],
      recentCommits: [],
    };
  }

  const uncommittedFiles: string[] = [];
  const untrackedFiles: string[] = [];
  for (const line of status.split("\n")) {
    if (!line.trim()) continue;
    const file = line.slice(3).trim();
    if (line.startsWith("??")) untrackedFiles.push(file);
    else uncommittedFiles.push(file);
  }

  const log = git(repoRoot, ["log", "--oneline", "-5"]);

  return {
    isRepo: true,
    branch: getGitBranch(repoRoot),
    head: getGitCommit(repoRoot)?.slice(0, 8),
    uncommittedFiles,
    untrackedFiles,
    recentCommits: log ? log.split("\n").filter(Boolean) : [],
  };
}

export interface ProjectIdentity {
  name?: string;
  version?: string;
  description?: string;
  entryPoints: string[];
  readme?: string;
}

/**
 * Answer "what is this project" from package.json and the README tagline.
 */
export function getProjectIdentity(repoRoot: string): ProjectIdentity {
  const identity: ProjectIdentity = { entryPoints: [] };

  const pkgRaw = readFileSafe(path.join(repoRoot, "package.json"));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      identity.name = pkg.name;
      identity.version = pkg.version;
      identity.description = pkg.description;
      if (typeof pkg.bin === "string") identity.entryPoints.push(pkg.bin);
      else if (pkg.bin) identity.entryPoints.push(...Object.values<string>(pkg.bin));
      if (pkg.main) identity.entryPoints.push(pkg.main);
    } catch {
      // leave identity partially filled
    }
  }

  const readme = readFileSafe(path.join(repoRoot, "README.md"));
  if (readme) {
    // First blockquote (tagline), else first plain paragraph line.
    const tagline = readme.match(/^>\s*(.+)$/m)?.[1];
    const firstPara = readme
      .split("\n")
      .find(
        (l) =>
          l.trim() &&
          !l.startsWith("#") &&
          !l.startsWith(">") &&
          !l.startsWith("[")
      );
    identity.readme = (tagline || firstPara || "").trim() || undefined;
  }

  return identity;
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
  // Single-pass translation: glob tokens and regex escapes are handled in one
  // replace so injected regex text is never re-scanned by a later substitution.
  const regexStr = pattern.replace(
    /\*\*\/|\*\*|\*|[.+?^${}()|[\]\\]/g,
    (token) => {
      if (token === "**/") return "(?:.*/)?";
      if (token === "**") return ".*";
      if (token === "*") return "[^/]*";
      return "\\" + token;
    }
  );
  return new RegExp("^" + regexStr + "$").test(filePath);
}

/**
 * Check if file matches any of the patterns
 */
export function matchesPatterns(filePath: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(filePath, p));
}
