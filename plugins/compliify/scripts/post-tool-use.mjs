#!/usr/bin/env node
// compliify PostToolUse hook (Write|Edit, async). Deliberately tiny and
// node:fs-only — NO LLM, no deps, no imports beyond node builtins. Appends
// the edited file path to .compliify/pending for the Stop hook to consume.
// Never exits non-zero: a governance queue must never break an edit.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

if (process.env.COMPLIIFY_EXTRACTION === "1") process.exit(0);

// The Stop hook consumes the queue at the git toplevel (resolveRepoRoot in
// the CLI). Anchor it the same way — nearest ancestor carrying a .git (repo
// root; file for worktrees) or an existing .compliify — so a session running
// in a subdirectory feeds the same .compliify/pending the Stop hook reads
// instead of leaving a stray queue the Stop hook never finds. Fallback: the
// cwd itself (matches resolveRepoRoot outside a git repo).
function anchorDir(startDir) {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, ".git")) || existsSync(join(dir, ".compliify"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(raw);
    const filePath = payload?.tool_input?.file_path;
    const cwd = payload?.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    if (
      typeof filePath === "string" &&
      filePath !== "" &&
      !filePath.includes(".compliify")
    ) {
      const dir = join(anchorDir(cwd), ".compliify");
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "pending"), `${filePath}\n`, "utf8");
    }
  } catch {
    // malformed payload / unwritable dir — swallow, this hook must be silent
  }
  process.exit(0);
});
process.stdin.on("error", () => process.exit(0));
