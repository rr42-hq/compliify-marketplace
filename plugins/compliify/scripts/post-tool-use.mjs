#!/usr/bin/env node
// compliify PostToolUse hook (Write|Edit, async). Deliberately tiny and
// node:fs-only - NO LLM, no deps, no imports beyond node builtins. Appends
// the edited file path to .compliify/pending for the Stop hook to consume.
// Never exits non-zero: a governance queue must never break an edit.
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

if (process.env.COMPLIIFY_EXTRACTION === "1") process.exit(0);

// The first edit in a repository creates .compliify/ with no `init` having
// run, so the directory must hide its own scratch files from git from the
// start. `*` also matches this file itself; only facts.json stays visible.
// Same text as COMPLIIFY_GITIGNORE in packages/cli/src/context.ts (this
// script cannot import the CLI); a test keeps the two identical.
const GITIGNORE = [
  "# compliify: session scratch (pending queue, lock and temp files) stays out of git; facts.json is the record to commit.",
  "*",
  "!facts.json",
  "",
].join("\n");

// The Stop hook consumes the queue at the git toplevel (resolveRepoRoot in
// the CLI). Anchor it the same way - nearest ancestor carrying a .git (repo
// root; file for worktrees) or an existing .compliify - so a session running
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
      // A repository can ship `.compliify` (or `.compliify/pending`) as a link to
      // somewhere else; this hook runs in whatever repository is opened and
      // must not append to a file outside of it.
      if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) process.exit(0);
      mkdirSync(dir, { recursive: true });
      // Before the queue file exists, so git never sees it. "wx" never
      // replaces a file that is already there (possibly edited by the user).
      if (!existsSync(join(dir, ".gitignore"))) {
        try {
          writeFileSync(join(dir, ".gitignore"), GITIGNORE, { encoding: "utf8", flag: "wx" });
        } catch {
          // raced with another hook, or unwritable: the queue below still works
        }
      }
      // O_NOFOLLOW: a link in the place of the queue file is an error (caught below), not a write.
      const fd = openSync(
        join(dir, "pending"),
        fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | (fsConstants.O_NOFOLLOW ?? 0),
        0o644,
      );
      try {
        writeSync(fd, `${filePath}\n`);
      } finally {
        closeSync(fd);
      }
    }
  } catch {
    // malformed payload / unwritable dir - swallow, this hook must be silent
  }
  process.exit(0);
});
process.stdin.on("error", () => process.exit(0));
