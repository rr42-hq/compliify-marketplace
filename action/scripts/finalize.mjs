#!/usr/bin/env node
// The last step of the action (`if: always()`). The earlier steps are all
// continue-on-error, so a wrong secret or a network blip would otherwise look
// like a green check. This step turns what they reported into
//   - a status table in the job summary,
//   - one warning annotation when something prevented a normal run, and
//   - the sticky pull request comment, updated in place: when something went
//     wrong it starts with "compliify did not run completely: <reason>".
//
// A comment can only be written with a write token: on a pull request from a
// fork GITHUB_TOKEN is read-only, so there the result stays in the job
// summary and nothing is attempted (and nothing errors).
//
// Observe mode: always exits 0.
//
// Environment: EVENT_NAME, PR_NUMBER, IS_FORK, GITHUB_TOKEN, API_KEY
// (present|missing), SERVER_URL_SET, TOKEN_SET, and per step
// <STEP>_OUTCOME plus the outputs RUNTIME_READY/_REASON, CLAUDE_READY/_REASON,
// SCAN_STATUS/_REASON, COMMENT_STATUS/_REASON/_FILE/_LEGACY; the runner's own
// GITHUB_API_URL, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID,
// GITHUB_STEP_SUMMARY, RUNNER_TEMP.
import { appendFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandText, errorText, isMain, mdText, oneLine, sleep, truncate } from "./lib.mjs";

export const COMMENT_MARKER = "<!-- compliify-governance -->";
export const INGEST_STATUS_FILE = "compliify-ingest-status.json";
/** GitHub rejects comments above 65536 characters. */
const COMMENT_LIMIT = 60_000;

/**
 * @typedef {"ok" | "problem" | "skipped" | "not configured"} RowState
 * @typedef {{ label: string, state: RowState, detail: string }} Row
 * @typedef {{ label: string, reason: string }} Problem
 * @typedef {{ outcome: string, ready: boolean, reason: string, version: string, mode?: string }} Gate
 * @typedef {{ outcome: string, status: string, reason: string }} Run
 * @typedef {{
 *   event: string,
 *   prNumber: string,
 *   isFork: boolean,
 *   apiKeyPresent: boolean,
 *   serverSet: boolean,
 *   tokenSet: boolean,
 *   runtime: Gate,
 *   claude: Gate,
 *   scan: Run,
 *   comment: Run & { file: string, legacy: boolean },
 *   ingest: { outcome: string },
 * }} Reported
 * @typedef {{ ok: boolean, httpStatus: number, message: string, factsSent: number, evidenceAttached: number }} IngestStatus
 */

// ── reading what the steps reported ─────────────────────────────────────────

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Reported}
 */
export function readState(env) {
  const str = (/** @type {string} */ name) => (env[name] ?? "").trim();
  const gate = (/** @type {string} */ p) => ({
    outcome: str(`${p}_OUTCOME`),
    ready: str(`${p}_READY`) === "true",
    reason: str(`${p}_REASON`),
    version: str(`${p}_VERSION`),
  });
  const run = (/** @type {string} */ p) => ({
    outcome: str(`${p}_OUTCOME`),
    status: str(`${p}_STATUS`),
    reason: str(`${p}_REASON`),
  });
  return {
    event: str("EVENT_NAME"),
    prNumber: str("PR_NUMBER"),
    isFork: str("IS_FORK") === "true",
    apiKeyPresent: str("API_KEY") === "present",
    serverSet: str("SERVER_URL_SET") === "true",
    tokenSet: str("TOKEN_SET") === "true",
    runtime: { ...gate("RUNTIME"), mode: str("RUNTIME_MODE") },
    claude: gate("CLAUDE"),
    scan: run("SCAN"),
    comment: { ...run("COMMENT"), file: str("COMMENT_FILE"), legacy: str("COMMENT_LEGACY") === "true" },
    ingest: { outcome: str("INGEST_OUTCOME") },
  };
}

/**
 * The status file written by ingest.mjs, or undefined when it is missing or
 * not in the expected shape.
 * @param {string} file
 * @returns {IngestStatus | undefined}
 */
export function readIngestStatus(file) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (typeof value?.ok !== "boolean") return undefined;
    return {
      ok: value.ok,
      httpStatus: Number.isInteger(value.httpStatus) ? value.httpStatus : 0,
      message: typeof value.message === "string" ? value.message : "",
      factsSent: Number.isInteger(value.factsSent) ? value.factsSent : 0,
      evidenceAttached: Number.isInteger(value.evidenceAttached) ? value.evidenceAttached : 0,
    };
  } catch {
    return undefined;
  }
}

// ── judging it ──────────────────────────────────────────────────────────────

/**
 * @param {number} n
 * @param {string} noun
 */
const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * No key is the default, not a fault: the model runs in each developer's own
 * Claude Code (the plugin), and this workflow checks and diffs what they
 * committed. Said in the job summary, never as a problem.
 */
const NO_KEY_DETAIL =
  "optional - without it no model runs in CI; the facts are the ones committed in .compliify/facts.json";

/** The last line of the pull request comment when nothing was scanned in this workflow. */
export const NO_SCAN_NOTE =
  "_Facts: the ones committed in `.compliify/facts.json`. No model ran in this workflow; set `anthropic_api_key` to also scan the changed files here._";

/**
 * One row per step and the list of problems that kept the run from being
 * complete. A skipped step is only a problem when nothing explains it: the
 * root cause (a failed download) is the problem, not the steps that could not
 * run because of it. Having no API key is not one: it is how the action runs
 * unless a team opts in to scanning in CI.
 * @param {Reported} state
 * @param {IngestStatus | undefined} ingest
 * @returns {{ rows: Row[], problems: Problem[] }}
 */
export function assess(state, ingest) {
  /** @type {Row[]} */
  const rows = [];
  /** @type {Problem[]} */
  const problems = [];
  const add = (/** @type {string} */ label, /** @type {RowState} */ rowState, /** @type {string} */ detail, /** @type {boolean} */ isProblem = false) => {
    rows.push({ label, state: rowState, detail });
    if (isProblem) problems.push({ label, reason: detail });
  };

  const rt = state.runtime;
  const runtimeReady = rt.outcome === "success" && rt.ready;
  if (runtimeReady) add("Runtime download", "ok", rt.reason);
  else {
    add(
      "Runtime download",
      "problem",
      rt.reason !== ""
        ? rt.reason
        : "the runtime download step did not finish - see its log (is Node.js >= 20 installed? add actions/setup-node)",
      true,
    );
  }

  if (state.apiKeyPresent) add("API key", "ok", "present");
  else add("API key", "not configured", NO_KEY_DETAIL);

  const cl = state.claude;
  const claudeReady = cl.outcome === "success" && cl.ready;
  if (!state.apiKeyPresent) add("Claude Code CLI", "skipped", "not needed without an API key");
  else if (!runtimeReady) add("Claude Code CLI", "skipped", "the runtime is not available");
  else if (claudeReady) add("Claude Code CLI", "ok", "installed");
  else {
    add(
      "Claude Code CLI",
      "problem",
      cl.reason !== "" ? cl.reason : "could not install the Claude Code CLI - see the step log",
      true,
    );
  }

  const sc = state.scan;
  if (!runtimeReady) add("Fact extraction", "skipped", "the runtime is not available");
  else if (!state.apiKeyPresent) add("Fact extraction", "skipped", "no API key - the committed facts are used as they are");
  else if (!claudeReady) add("Fact extraction", "skipped", "the Claude Code CLI is not available");
  else if (sc.status === "ok") add("Fact extraction", "ok", sc.reason);
  else if (sc.status === "skipped") add("Fact extraction", "skipped", sc.reason);
  else {
    add(
      "Fact extraction",
      "problem",
      sc.reason !== "" ? sc.reason : "the extraction step did not finish - see its log",
      true,
    );
  }

  const cm = state.comment;
  if (!runtimeReady) add("Governance result", "skipped", "the runtime is not available");
  else if (cm.status === "ok") add("Governance result", "ok", cm.legacy ? cm.reason : "");
  else {
    add(
      "Governance result",
      "problem",
      cm.reason !== "" ? cm.reason : "the comment step did not finish - see its log",
      true,
    );
  }

  if (!state.serverSet && !state.tokenSet) {
    add("Push to the compliify server", "not configured", "set server_url and compliify_token to push the facts");
  } else if (!state.tokenSet) {
    add(
      "Push to the compliify server",
      "problem",
      "server_url is set but compliify_token is empty - add the token as a repository secret; secrets are not available to pull requests from forks",
      true,
    );
  } else if (!state.serverSet) {
    add("Push to the compliify server", "problem", "compliify_token is set but server_url is empty", true);
  } else if (ingest !== undefined && ingest.ok) {
    const sent =
      ingest.factsSent > 0
        ? ` (${plural(ingest.factsSent, "fact")}, ${plural(ingest.evidenceAttached, "source snippet")})`
        : "";
    add("Push to the compliify server", "ok", `${ingest.message}${sent}`);
  } else if (ingest !== undefined) {
    add(
      "Push to the compliify server",
      "problem",
      ingest.httpStatus === 401
        ? "the server rejected the token (HTTP 401) - check COMPLIIFY_TOKEN"
        : `pushing the facts to the compliify server failed: ${ingest.message}`,
      true,
    );
  } else {
    add(
      "Push to the compliify server",
      "problem",
      "the ingest step did not finish - see its log",
      true,
    );
  }

  return { rows, problems };
}

// ── the comment ─────────────────────────────────────────────────────────────

/**
 * `body` without its opening marker line.
 * @param {string} body
 * @returns {string}
 */
function withoutMarker(body) {
  const lines = body.split("\n");
  if (lines[0] === COMMENT_MARKER) lines.shift();
  while (lines[0] === "") lines.shift();
  return lines.join("\n").trimEnd();
}

/**
 * Link to this workflow run, built from the runner's own variables.
 * @param {Record<string, string | undefined>} env
 * @returns {string | undefined}
 */
export function runUrlFrom(env) {
  const server = (env["GITHUB_SERVER_URL"] ?? "").trim().replace(/\/+$/, "");
  const repo = (env["GITHUB_REPOSITORY"] ?? "").trim();
  const run = (env["GITHUB_RUN_ID"] ?? "").trim();
  if (!/^https?:\/\/[A-Za-z0-9.:-]+$/.test(server)) return undefined;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^\d+$/.test(run)) return undefined;
  return `${server}/${repo}/actions/runs/${run}`;
}

/**
 * The text of the sticky comment: the governance result, or - when something
 * prevented a normal run - the reason first and whatever result there is
 * below it.
 * `note`, when there is one, is the last line (where the facts came from).
 * @param {{ problems: Problem[], body: string | undefined, runUrl?: string | undefined, note?: string | undefined }} input
 * @returns {string | undefined} undefined when there is nothing to say
 */
export function composeComment({ problems, body, runUrl, note }) {
  const tail = note !== undefined && note !== "" && body !== undefined ? `\n\n${note}` : "";
  const limit = COMMENT_LIMIT - tail.length;
  if (problems.length === 0) {
    if (body === undefined) return undefined;
    return tail === "" ? truncate(body, limit) : `${truncate(body.trimEnd(), limit)}${tail}`;
  }
  const [first, ...more] = /** @type {[Problem, ...Problem[]]} */ (problems);
  const lines = [COMMENT_MARKER, `> **compliify did not run completely: ${mdText(first.reason, 500)}**`];
  if (more.length > 0) {
    lines.push(">");
    for (const p of more) lines.push(`> - ${mdText(`${p.label}: ${p.reason}`, 500)}`);
  }
  if (runUrl !== undefined) lines.push(">", `> Details: [workflow run](${runUrl})`);
  const rest = body === undefined ? "" : withoutMarker(body);
  lines.push("", rest !== "" ? rest : "_No governance result is available for this run._");
  return `${truncate(lines.join("\n"), limit)}${tail}`;
}

// ── GitHub API ──────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   apiUrl: string,
 *   repository: string,
 *   prNumber: string,
 *   token: string,
 *   body: string,
 *   fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => Promise<void>,
 *   timeoutMs?: number,
 * }} UpsertOptions
 * @typedef {{ state: "created" | "updated" | "unchanged" | "failed", message: string }} UpsertResult
 */

/**
 * Why a GitHub call failed, in words a workflow author can act on.
 * @param {number} status
 * @param {string} what
 * @returns {string}
 */
function apiProblem(status, what) {
  if (status === 401) return `the GitHub token was rejected (HTTP 401) while ${what}`;
  if (status === 403)
    return `the token may not write pull request comments (HTTP 403) while ${what} - give the workflow permissions: pull-requests: write`;
  if (status === 404) return `pull request or repository not found (HTTP 404) while ${what}`;
  return `HTTP ${status} while ${what}`;
}

/**
 * Create the compliify comment on the pull request, or update the one that
 * is there. Never throws.
 * @param {UpsertOptions} options
 * @returns {Promise<UpsertResult>}
 */
export async function upsertComment(options) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const wait = options.sleep ?? sleep;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const apiUrl = options.apiUrl.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(apiUrl)) return { state: "failed", message: "GITHUB_API_URL is not an http(s) URL" };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository) || !/^\d+$/.test(options.prNumber)) {
    return { state: "failed", message: "the repository or pull request number is not valid" };
  }
  if (options.token === "") return { state: "failed", message: "github_token is empty" };

  /**
   * @param {string} method
   * @param {string} url
   * @param {unknown} [payload]
   * @returns {Promise<{ status: number, json: any }>}
   */
  async function call(method, url, payload) {
    /** @type {unknown} */
    let last;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${options.token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "compliify-action",
            ...(payload !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        if (res.status >= 500 && attempt < 3) {
          last = new Error(`HTTP ${res.status}`);
        } else {
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          return { status: res.status, json };
        }
      } catch (err) {
        last = err;
      }
      if (attempt < 3) await wait(1000 * 2 ** (attempt - 1));
    }
    throw last;
  }

  const repoPath = `${apiUrl}/repos/${options.repository}`;
  try {
    /** @type {any[]} */
    const comments = [];
    for (let page = 1; page <= 10; page += 1) {
      const res = await call("GET", `${repoPath}/issues/${options.prNumber}/comments?per_page=100&page=${page}`);
      if (res.status !== 200 || !Array.isArray(res.json)) {
        return { state: "failed", message: apiProblem(res.status, "listing the comments") };
      }
      comments.push(...res.json);
      if (res.json.length < 100) break;
    }
    const mine = comments.filter((c) => typeof c?.body === "string" && c.body.startsWith(COMMENT_MARKER));
    // Anyone can post a comment that starts with the marker: prefer the one a bot wrote.
    const existing = mine.find((c) => c?.user?.type === "Bot") ?? mine[0];

    if (existing !== undefined) {
      if (existing.body === options.body) return { state: "unchanged", message: "the comment is already up to date" };
      const res = await call("PATCH", `${repoPath}/issues/comments/${existing.id}`, { body: options.body });
      if (res.status === 200) return { state: "updated", message: "updated the comment in place" };
      // Not ours to edit (or gone): write a new one rather than lose the result.
    }
    const res = await call("POST", `${repoPath}/issues/${options.prNumber}/comments`, { body: options.body });
    if (res.status === 201) return { state: "created", message: "posted the comment" };
    return { state: "failed", message: apiProblem(res.status, "posting the comment") };
  } catch (err) {
    return { state: "failed", message: `could not reach GitHub: ${oneLine(errorText(err), 160)}` };
  }
}

// ── the job summary ─────────────────────────────────────────────────────────

/**
 * @param {{
 *   rows: Row[],
 *   problems: Problem[],
 *   body: string | undefined,
 *   post: { state: string, message: string },
 *   runUrl?: string | undefined,
 * }} input
 * @returns {string}
 */
export function summaryMarkdown({ rows, problems, body, post, runUrl }) {
  const lines = ["## compliify governance check", ""];
  if (problems.length > 0) {
    lines.push(`> **compliify did not run completely: ${mdText(problems[0]?.reason, 500)}**`);
    for (const p of problems.slice(1)) lines.push(">", `> - ${mdText(`${p.label}: ${p.reason}`, 500)}`);
    lines.push("");
  }
  lines.push("| Step | Result | Details |", "| --- | --- | --- |");
  for (const row of rows) lines.push(`| ${row.label} | ${row.state} | ${mdText(row.detail, 400)} |`);
  const posted =
    post.state === "failed"
      ? "problem"
      : post.state === "skipped"
        ? "skipped"
        : "ok";
  lines.push(`| Pull request comment | ${posted} | ${mdText(post.message, 400)} |`);
  lines.push("", "_Observe mode: compliify never fails the build._");
  if (runUrl !== undefined && problems.length > 0) lines.push("", `[Workflow run](${runUrl})`);
  if (body !== undefined && body !== "") lines.push("", "---", "", withoutMarker(body));
  return `${lines.join("\n")}\n`;
}

// ── command ─────────────────────────────────────────────────────────────────

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {{ fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, log?: (line: string) => void }} [deps]
 */
export async function main(env = process.env, deps = {}) {
  const log = deps.log ?? ((line) => void process.stdout.write(`${line}\n`));
  try {
    const state = readState(env);
    const tempDir = env["RUNNER_TEMP"] || os.tmpdir();
    const ingest =
      state.serverSet && state.tokenSet ? readIngestStatus(path.join(tempDir, INGEST_STATUS_FILE)) : undefined;
    const { rows, problems } = assess(state, ingest);

    /** @type {string | undefined} */
    let body;
    if (state.comment.status === "ok" && state.comment.file !== "") {
      try {
        body = readFileSync(state.comment.file, "utf8");
      } catch {
        body = undefined;
      }
    }
    const runUrl = runUrlFrom(env);
    const comment = composeComment({ problems, body, runUrl, note: state.apiKeyPresent ? undefined : NO_SCAN_NOTE });

    /** @type {{ state: string, message: string }} */
    let post;
    const isPullRequest = state.event === "pull_request" && /^\d+$/.test(state.prNumber);
    if (!isPullRequest) post = { state: "skipped", message: "not a pull_request event - the result is in this summary" };
    else if (state.isFork) {
      post = {
        state: "skipped",
        message: "pull request from a fork: GITHUB_TOKEN is read-only there, so the result stays in this summary",
      };
    } else if (comment === undefined) post = { state: "skipped", message: "there is no result to post" };
    else {
      const result = await upsertComment({
        apiUrl: env["GITHUB_API_URL"] || "https://api.github.com",
        repository: env["GITHUB_REPOSITORY"] ?? "",
        prNumber: state.prNumber,
        token: (env["GITHUB_TOKEN"] ?? "").trim(),
        body: comment,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
      });
      post = { state: result.state === "failed" ? "failed" : "posted", message: result.message };
    }

    for (const row of rows) log(`compliify: ${row.state.padEnd(14)} ${row.label}${row.detail !== "" ? ` - ${oneLine(row.detail, 300)}` : ""}`);
    log(`compliify: pull request comment - ${post.message}`);

    const summaryFile = env["GITHUB_STEP_SUMMARY"];
    if (summaryFile !== undefined && summaryFile !== "") {
      try {
        appendFileSync(summaryFile, summaryMarkdown({ rows, problems, body, post, runUrl }));
      } catch (err) {
        log(`compliify: could not write the job summary (${oneLine(errorText(err), 120)})`);
      }
    }
    if (problems.length > 0) {
      log(`::warning::${commandText(`compliify did not run completely: ${problems.map((p) => p.reason).join("; ")}`)}`);
    }
    // Not a problem of this run, but not something to leave in the log alone:
    // what ran was not checked against a manifest.
    if (state.runtime.mode === "legacy" && state.runtime.ready) {
      log(
        `::warning::${commandText("compliify: the plugin runtime was downloaded without checksum verification - the marketplace has no runtime-manifest.json for this ref yet. Pin marketplace_ref to a release once one is published.")}`,
      );
    }
    if (post.state === "failed") {
      log(`::warning::${commandText(`compliify could not post the pull request comment: ${post.message}`)}`);
    }
  } catch (err) {
    log(`::warning::${commandText(`compliify could not report its result: ${errorText(err)}`)}`);
  }
}

if (isMain(import.meta.url)) {
  main().catch(() => undefined);
}
