#!/usr/bin/env node
// Builds the Markdown body of the pull request comment by running the
// downloaded runtime: `compliify pr-comment` (short, deep-linked).
//
// Transition: a runtime published before `pr-comment` existed answers "unknown
// command". Then the long format of the previous action is composed from
// `check` and `diff` instead, and the status says so, so a lagging plugin
// release degrades the comment instead of losing it.
//
// Observe mode: always exits 0. Outputs (appended to $GITHUB_OUTPUT):
//   status  ok | failed
//   file    path of the body (when ok)
//   legacy  true when the long format was used
//   reason  one line: why it failed, or the note about the long format
//
// Environment: COMPLIIFY_JS (the bundle), MERGE_BASE, CONSOLE_URL,
// RUNNER_TEMP, MARKETPLACE_REF (only for the wording of the note).
import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { errorText, isMain, oneLine, setOutputs } from "./lib.mjs";

const execFileAsync = promisify(execFile);

export const COMMENT_MARKER = "<!-- compliify-governance -->";
export const COMMENT_FILE_NAME = "compliify-comment.md";

/**
 * @typedef {{
 *   ok: boolean,
 *   legacy: boolean,
 *   file: string,
 *   reason: string,
 * }} BuildResult
 */

/**
 * Run the bundle with `args`; resolves with the exit code, stdout and stderr
 * instead of rejecting on a non-zero exit.
 * @param {string} bundle
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function runBundle(bundle, args, timeoutMs) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bundle, ...args], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = /** @type {{ code?: unknown, killed?: boolean, stdout?: unknown, stderr?: unknown, message?: unknown }} */ (err);
    return {
      code: typeof e.code === "number" ? e.code : 1,
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr:
        e.killed === true
          ? `timed out after ${timeoutMs / 1000} s`
          : typeof e.stderr === "string" && e.stderr.trim() !== ""
            ? e.stderr
            : errorText(err),
    };
  }
}

/**
 * The last non-empty line of a process's stderr, for a one-line reason.
 * @param {string} text
 * @returns {string}
 */
function lastLine(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return oneLine(lines[lines.length - 1] ?? "no output", 240);
}

/**
 * The long comment of the previous action, from `check` and `diff`.
 * @param {string} bundle
 * @param {string} base
 * @param {number} timeoutMs
 * @returns {Promise<string | undefined>} undefined when `check` failed
 */
async function legacyBody(bundle, base, timeoutMs) {
  const check = await runBundle(bundle, ["check", "--format", "markdown"], timeoutMs);
  if (check.code !== 0) return undefined;
  let diff = "_No governance diff available for this run._";
  if (base !== "") {
    const result = await runBundle(bundle, ["diff", base, "HEAD", "--format", "markdown"], timeoutMs);
    if (result.code === 0 && result.stdout.trim() !== "") diff = result.stdout.trim();
  }
  return [
    COMMENT_MARKER,
    "## compliify - governance delta",
    "",
    diff,
    "",
    "### Current findings",
    "",
    check.stdout.trim() || "_No findings output available for this run._",
    "",
    "_compliify runs in observe mode: it never blocks this build._",
    "",
  ].join("\n");
}

/**
 * @param {{
 *   compliifyJs: string,
 *   mergeBase?: string,
 *   consoleUrl?: string,
 *   outDir?: string,
 *   marketplaceRef?: string,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<BuildResult>}
 */
export async function buildComment(options) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const file = path.join(options.outDir ?? os.tmpdir(), COMMENT_FILE_NAME);
  rmSync(file, { force: true });
  const fail = (/** @type {string} */ reason) => ({ ok: false, legacy: false, file: "", reason: oneLine(reason, 400) });

  if (options.compliifyJs === "" || !existsSync(options.compliifyJs)) {
    return fail("the comment could not be built: the compliify runtime is not available");
  }
  const base = (options.mergeBase ?? "").trim();
  const consoleUrl = (options.consoleUrl ?? "").trim();
  const args = [
    "pr-comment",
    ...(base !== "" ? ["--base", base] : []),
    ...(consoleUrl !== "" ? ["--console-url", consoleUrl] : []),
  ];
  const run = await runBundle(options.compliifyJs, args, timeoutMs);
  if (run.code === 0 && run.stdout.startsWith(COMMENT_MARKER)) {
    writeFileSync(file, run.stdout);
    return { ok: true, legacy: false, file, reason: "" };
  }
  if (run.code !== 0 && /unknown command/i.test(run.stderr)) {
    const body = await legacyBody(options.compliifyJs, base, timeoutMs);
    if (body === undefined) return fail("the comment could not be built: compliify check failed");
    writeFileSync(file, body);
    const ref = options.marketplaceRef ?? "";
    return {
      ok: true,
      legacy: true,
      file,
      reason: `the compliify runtime${ref !== "" ? ` (${oneLine(ref, 60)})` : ""} predates the pr-comment command - using the long comment format until a newer plugin release is published`,
    };
  }
  if (run.code === 0) return fail("the comment could not be built: pr-comment printed no comment");
  return fail(`the comment could not be built: ${lastLine(run.stderr)}`);
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<BuildResult>}
 */
export async function main(env = process.env) {
  const result = await buildComment({
    compliifyJs: env["COMPLIIFY_JS"] ?? "",
    mergeBase: env["MERGE_BASE"] ?? "",
    consoleUrl: env["CONSOLE_URL"] ?? "",
    outDir: env["RUNNER_TEMP"] || os.tmpdir(),
    marketplaceRef: env["MARKETPLACE_REF"] ?? "",
  });
  setOutputs({
    status: result.ok ? "ok" : "failed",
    file: result.file,
    legacy: result.legacy,
    reason: result.reason,
  });
  // The step log shows the comment, as the old check and diff steps did.
  if (result.ok) process.stdout.write(`${readFileSync(result.file, "utf8")}\n`);
  if (result.reason !== "") process.stderr.write(`compliify: ${result.reason}\n`);
  return result;
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    setOutputs({ status: "failed", file: "", legacy: false, reason: `the comment could not be built: ${errorText(err)}` });
  });
}
