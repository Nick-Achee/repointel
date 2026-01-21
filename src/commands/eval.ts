import pc from "picocolors";
import { validateAll, validateArtifact } from "../validators/eval.js";
import type { EvalResult, EvalIssue } from "../types/index.js";

export interface EvalCommandOptions {
  target?: string;
  strict?: boolean;
}

function printIssue(issue: EvalIssue): void {
  const icon =
    issue.severity === "error"
      ? pc.red("✗")
      : issue.severity === "warning"
        ? pc.yellow("⚠")
        : pc.blue("ℹ");

  const color =
    issue.severity === "error"
      ? pc.red
      : issue.severity === "warning"
        ? pc.yellow
        : pc.blue;

  console.log(`  ${icon} ${color(`[${issue.code}]`)} ${issue.message}`);
  if (issue.file) {
    console.log(`    ${pc.dim(`→ ${issue.file}${issue.line ? `:${issue.line}` : ""}`)}`);
  }
}

function printResult(result: EvalResult): void {
  const statusIcon = result.passed ? pc.green("✓") : pc.red("✗");
  const statusText = result.passed ? pc.green("PASSED") : pc.red("FAILED");

  console.log(`\n${statusIcon} ${pc.bold(result.target)} ${statusText}`);
  console.log(
    pc.dim(
      `  Errors: ${result.stats.errors} | Warnings: ${result.stats.warnings} | Info: ${result.stats.infos}`
    )
  );

  if (result.issues.length > 0) {
    console.log("");
    for (const issue of result.issues) {
      printIssue(issue);
    }
  }
}

export async function evalCommand(options: EvalCommandOptions): Promise<void> {
  const root = process.cwd();

  console.log(pc.cyan("\n🔎 Validating artifacts...\n"));

  let results: EvalResult[];

  if (options.target) {
    // Validate specific target
    results = [await validateArtifact({ target: options.target, root })];
  } else {
    // Validate all
    results = await validateAll(root);
  }

  // Print results
  for (const result of results) {
    printResult(result);
  }

  // Summary
  const totalErrors = results.reduce((sum, r) => sum + r.stats.errors, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.stats.warnings, 0);
  const allPassed = results.every((r) => r.passed);

  console.log("\n" + pc.cyan("━".repeat(50)));

  if (allPassed) {
    console.log(pc.green("✅ All validations passed"));
  } else {
    console.log(pc.red(`❌ Validation failed: ${totalErrors} errors, ${totalWarnings} warnings`));
  }

  console.log(pc.cyan("━".repeat(50)) + "\n");

  // Exit with error code if strict mode and warnings exist
  if (options.strict && totalWarnings > 0) {
    process.exit(1);
  }

  // Exit with error code if any errors
  if (totalErrors > 0) {
    process.exit(1);
  }
}
