#!/usr/bin/env node
// Downloads the plugin runtime the compliify CLI bundle needs and verifies it.
//
// The bundle (dist/compliify.js) resolves its assets relative to itself:
// ../package.json and ../templates/art30-ropa.md are read when it loads,
// ../rules/*.yaml when it evaluates, ../skills/extract-facts/SKILL.md when it
// scans. A runtime that is missing any of them looks installed and then fails
// later, so this script either delivers all of it or says exactly why not.
//
// Primary path: <raw>/<repo>/<ref>/plugins/compliify/runtime-manifest.json
// lists every file with its sha256 and size; each file is downloaded, checked
// against both, and only then written (temp file + rename). Nothing touches
// the disk until every file has been verified, so a failed run leaves nothing
// behind that could be mistaken for a runtime.
//
// Transition path: marketplace content published before the manifest existed
// answers 404. Then the files are fetched the legacy way (fixed list plus the
// rules listed through the GitHub contents API) WITHOUT checksums, and the
// log says so. Only a 404 triggers this: any other failure to fetch the
// manifest must not silently downgrade to unverified downloads.
//
// Observe mode: this never throws out of the CLI entry and never exits
// non-zero. The outcome is reported as step outputs (ready, compliify_js,
// version, reason) appended to $GITHUB_OUTPUT (stdout when unset).
//
// Environment (CLI): MARKETPLACE_REF (default main), MARKETPLACE_REPO
// (default rr42-hq/compliify-marketplace), RUNTIME_DIR (required),
// GITHUB_TOKEN (optional, sent to the API host only), and the test seams
// COMPLIIFY_RAW_BASE / COMPLIIFY_API_BASE.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorText, isMain, oneLine, setOutputs, sleep } from "./lib.mjs";

export const DEFAULT_REPO = "rr42-hq/compliify-marketplace";
export const DEFAULT_REF = "main";
export const MANIFEST_NAME = "runtime-manifest.json";
const DEFAULT_RAW_BASE = "https://raw.githubusercontent.com";
const DEFAULT_API_BASE = "https://api.github.com";
const PLUGIN_PATH = "plugins/compliify";
const USER_AGENT = "compliify-action";

/** Hard limits on what a manifest may ask this script to download. */
export const LIMITS = Object.freeze({
  maxFiles: 200,
  maxTotalBytes: 20 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024,
  maxPathLength: 200,
  maxSegmentLength: 100,
  /** Largest GitHub API listing read (the rules directory). */
  maxListingBytes: 2 * 1024 * 1024,
});

/** Files without which the bundle does not load or cannot scan. */
const REQUIRED_FILES = Object.freeze([
  "dist/compliify.js",
  "package.json",
  "templates/art30-ropa.md",
  "skills/extract-facts/SKILL.md",
]);

/** The fixed part of the legacy download list (rules/ is listed via the API). */
const LEGACY_FILES = REQUIRED_FILES;

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_PATTERN = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const RULE_FILE = /^rules\/[^/]+\.ya?ml$/;

/**
 * @typedef {{ path: string, sha256?: string, size?: number }} RuntimeFile
 * @typedef {{
 *   ready: boolean,
 *   compliifyJs: string,
 *   version: string,
 *   reason: string,
 *   mode: "manifest" | "legacy" | "none",
 *   files: number,
 * }} FetchRuntimeResult
 * @typedef {{
 *   ref?: string | undefined,
 *   repo?: string | undefined,
 *   runtimeDir?: string | undefined,
 *   token?: string | undefined,
 *   rawBase?: string | undefined,
 *   apiBase?: string | undefined,
 *   attempts?: number,
 *   timeoutMs?: number,
 *   baseDelayMs?: number,
 *   concurrency?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   fetchImpl?: typeof fetch,
 *   nodeVersion?: string,
 *   log?: (line: string) => void,
 * }} FetchRuntimeOptions
 */

// ── errors ──────────────────────────────────────────────────────────────────

/** A non-2xx answer. */
class HttpError extends Error {
  /** @param {number} status @param {string} statusText */
  constructor(status, statusText) {
    super(`HTTP ${status}${statusText !== "" ? ` ${oneLine(statusText, 60)}` : ""}`);
    this.status = status;
  }
}
/** The request did not complete: DNS, refused, reset, timeout. */
class NetworkError extends Error {}
/** Downloaded bytes do not match what the manifest promised. */
class IntegrityError extends Error {}
/** The manifest (or a listing) is not acceptable. */
class ManifestError extends Error {}

/** @param {Error} err */
function isRetryable(err) {
  if (err instanceof HttpError) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  return err instanceof NetworkError || err instanceof IntegrityError;
}

// ── manifest validation ─────────────────────────────────────────────────────

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accept only a plain relative path of safe segments. The manifest is fetched
 * over the network and decides where files are written, so everything that
 * could leave the runtime directory (absolute paths, `..`, backslashes, drive
 * letters, empty or dotted segments, odd characters) is refused outright.
 * @param {unknown} value
 * @returns {string} the validated path
 */
export function checkRelativePath(value) {
  const shown = typeof value === "string" ? JSON.stringify(oneLine(value, 80)) : typeof value;
  if (typeof value !== "string" || value === "") {
    throw new ManifestError(`invalid file path ${shown}: not a non-empty string`);
  }
  if (value.length > LIMITS.maxPathLength) {
    throw new ManifestError(`invalid file path ${shown}: longer than ${LIMITS.maxPathLength} characters`);
  }
  if (value.includes("\\")) {
    throw new ManifestError(`invalid file path ${shown}: contains a backslash`);
  }
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new ManifestError(`invalid file path ${shown}: absolute paths are not allowed`);
  }
  for (const segment of value.split("/")) {
    if (segment === "..") {
      throw new ManifestError(`invalid file path ${shown}: ".." is not allowed`);
    }
    if (
      segment === "" ||
      segment === "." ||
      segment.length > LIMITS.maxSegmentLength ||
      !SEGMENT_PATTERN.test(segment)
    ) {
      throw new ManifestError(
        `invalid file path ${shown}: only plain names made of letters, digits, ".", "_" and "-" are allowed`,
      );
    }
  }
  return value;
}

/**
 * Validate the parsed runtime manifest strictly.
 * @param {unknown} value
 * @returns {{ version: string, files: Required<RuntimeFile>[] }}
 */
export function validateManifest(value) {
  if (!isPlainObject(value)) throw new ManifestError("the manifest is not a JSON object");
  const version = value["version"];
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    throw new ManifestError('the manifest has no valid "version"');
  }
  const list = value["files"];
  if (!Array.isArray(list) || list.length === 0) {
    throw new ManifestError('the manifest has no "files"');
  }
  if (list.length > LIMITS.maxFiles) {
    throw new ManifestError(`the manifest lists ${list.length} files (more than ${LIMITS.maxFiles})`);
  }
  /** @type {Required<RuntimeFile>[]} */
  const files = [];
  const seen = new Set();
  let total = 0;
  for (const entry of list) {
    if (!isPlainObject(entry)) throw new ManifestError("a manifest file entry is not an object");
    const filePath = checkRelativePath(entry["path"]);
    const sha256 = entry["sha256"];
    if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256)) {
      throw new ManifestError(`${filePath}: "sha256" is not a 64-character hex digest`);
    }
    const size = entry["size"];
    if (typeof size !== "number" || !Number.isInteger(size) || size < 0) {
      throw new ManifestError(`${filePath}: "size" is not a non-negative integer`);
    }
    if (size > LIMITS.maxTotalBytes) {
      throw new ManifestError(`${filePath}: ${size} bytes is more than the ${LIMITS.maxTotalBytes} byte limit`);
    }
    // Case-folded: on a case-insensitive filesystem two spellings would
    // overwrite each other and defeat the per-file verification.
    const folded = filePath.toLowerCase();
    if (seen.has(folded)) throw new ManifestError(`${filePath}: listed twice`);
    seen.add(folded);
    total += size;
    if (total > LIMITS.maxTotalBytes) {
      throw new ManifestError(
        `the manifest asks for more than ${LIMITS.maxTotalBytes / (1024 * 1024)} MB in total`,
      );
    }
    files.push({ path: filePath, sha256: sha256.toLowerCase(), size });
  }
  assertComplete(files.map((f) => f.path));
  return { version, files };
}

/** @param {string[]} paths */
function assertComplete(paths) {
  const have = new Set(paths);
  for (const required of REQUIRED_FILES) {
    if (!have.has(required)) throw new ManifestError(`${required} is missing from the runtime`);
  }
  if (!paths.some((p) => RULE_FILE.test(p))) {
    throw new ManifestError("the runtime has no rules/*.yaml file");
  }
}

// ── configuration ───────────────────────────────────────────────────────────

/** @param {string} value */
const stripSlash = (value) => value.replace(/\/+$/, "");

/**
 * @param {string} name
 * @param {string} value
 * @returns {string}
 */
function httpBase(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must be an http(s) URL`);
  }
  return stripSlash(url.href);
}

/**
 * @param {FetchRuntimeOptions} options
 */
function resolveConfig(options) {
  const repo = options.repo || DEFAULT_REPO;
  const ref = options.ref || DEFAULT_REF;
  if (!REPO_PATTERN.test(repo) || repo.includes("..")) {
    throw new Error(`MARKETPLACE_REPO "${oneLine(repo, 80)}" is not an owner/name repository`);
  }
  if (!REF_PATTERN.test(ref) || ref.includes("..")) {
    throw new Error(`MARKETPLACE_REF "${oneLine(ref, 80)}" is not a plain branch, tag or commit name`);
  }
  if (options.runtimeDir === undefined || options.runtimeDir === "") {
    throw new Error("RUNTIME_DIR is not set");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("this Node.js has no global fetch - compliify needs Node.js >= 20");
  }
  return {
    repo,
    ref,
    runtimeDir: path.resolve(options.runtimeDir),
    token: options.token ?? "",
    rawBase: httpBase("COMPLIIFY_RAW_BASE", options.rawBase || DEFAULT_RAW_BASE),
    apiBase: httpBase("COMPLIIFY_API_BASE", options.apiBase || DEFAULT_API_BASE),
    attempts: options.attempts ?? 3,
    timeoutMs: options.timeoutMs ?? 30_000,
    baseDelayMs: options.baseDelayMs ?? 1000,
    concurrency: options.concurrency ?? 4,
    sleep: options.sleep ?? sleep,
    fetchImpl,
    log: options.log ?? ((line) => void process.stderr.write(`${line}\n`)),
  };
}

/** @typedef {ReturnType<typeof resolveConfig>} Config */

/**
 * @param {Config} cfg
 * @param {string} relPath path below plugins/compliify
 */
function rawUrl(cfg, relPath) {
  const ref = cfg.ref.split("/").map(encodeURIComponent).join("/");
  const rel = relPath.split("/").map(encodeURIComponent).join("/");
  return `${cfg.rawBase}/${cfg.repo}/${ref}/${PLUGIN_PATH}/${rel}`;
}

// ── HTTP ────────────────────────────────────────────────────────────────────

/**
 * @param {unknown} err
 * @param {number} timeoutMs
 */
function networkError(err, timeoutMs) {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new NetworkError(`request timed out after ${timeoutMs / 1000} s`);
  }
  return new NetworkError(`network error (${oneLine(errorText(err), 160)})`);
}

/**
 * Read a response body, refusing more than `maxBytes` (a server that sends
 * more than it declared must not be able to exhaust memory).
 * @param {Response} res
 * @param {number} maxBytes
 */
async function readCapped(res, maxBytes) {
  // A compressed body is declared by its compressed length, which for a tiny
  // file can exceed the file itself: only an uncompressed length is comparable.
  const encoded = (res.headers.get("content-encoding") ?? "identity").toLowerCase() !== "identity";
  const declared = Number(res.headers.get("content-length"));
  if (!encoded && Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new IntegrityError(`the response is larger than the expected ${maxBytes} bytes`);
  }
  if (res.body === null) return Buffer.alloc(0);
  const reader = res.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new IntegrityError(`the response is larger than the expected ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * One request attempt.
 * @param {Config} cfg
 * @param {string} url
 * @param {{ headers?: Record<string, string>, maxBytes: number }} opts
 * @returns {Promise<Buffer>}
 */
async function getOnce(cfg, url, { headers = {}, maxBytes }) {
  let res;
  try {
    res = await cfg.fetchImpl(url, {
      headers: { "user-agent": USER_AGENT, ...headers },
      signal: AbortSignal.timeout(cfg.timeoutMs),
      redirect: "follow",
    });
  } catch (err) {
    throw networkError(err, cfg.timeoutMs);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpError(res.status, res.statusText);
  }
  try {
    return await readCapped(res, maxBytes);
  } catch (err) {
    if (err instanceof IntegrityError) throw err;
    throw networkError(err, cfg.timeoutMs);
  }
}

/**
 * Run `attempt` up to cfg.attempts times, waiting baseDelayMs * 2^(n-1)
 * between tries (1 s, 2 s, 4 s ... with the defaults). Only transient
 * failures are retried: network errors and timeouts, 5xx/408/429, and a body
 * that fails its integrity check (a truncated transfer or a CDN edge that is
 * a moment behind). A 404 or any other 4xx is final.
 * @template T
 * @param {Config} cfg
 * @param {string} label prefixed to the final error message
 * @param {() => Promise<T>} attempt
 * @returns {Promise<T>}
 */
async function withRetries(cfg, label, attempt) {
  /** @type {unknown} */
  let last;
  for (let n = 1; n <= cfg.attempts; n += 1) {
    try {
      return await attempt();
    } catch (err) {
      last = err;
      if (!(err instanceof Error) || !isRetryable(err) || n === cfg.attempts) break;
      await cfg.sleep(cfg.baseDelayMs * 2 ** (n - 1));
    }
  }
  if (last instanceof Error && label !== "") last.message = `${label}: ${last.message}`;
  throw last;
}

// ── manifest + file download ────────────────────────────────────────────────

/**
 * @param {Config} cfg
 * @returns {Promise<{ kind: "manifest", version: string, files: Required<RuntimeFile>[] } | { kind: "missing" }>}
 */
async function loadManifest(cfg) {
  let body;
  try {
    body = await withRetries(cfg, MANIFEST_NAME, async () => {
      try {
        return await getOnce(cfg, rawUrl(cfg, MANIFEST_NAME), { maxBytes: LIMITS.maxManifestBytes });
      } catch (err) {
        // Deterministic, so not worth another attempt.
        if (err instanceof IntegrityError) {
          throw new ManifestError(`larger than ${LIMITS.maxManifestBytes / 1024} KiB`);
        }
        throw err;
      }
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return { kind: "missing" };
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new ManifestError(`${MANIFEST_NAME} is not valid JSON`);
  }
  return { kind: "manifest", ...validateManifest(parsed) };
}

/**
 * The rule files of the legacy layout, listed through the GitHub contents API.
 * @param {Config} cfg
 * @returns {Promise<string[]>} paths like rules/legal.pii-egress-unknown.yaml
 */
async function listLegacyRules(cfg) {
  const url = `${cfg.apiBase}/repos/${cfg.repo}/contents/${PLUGIN_PATH}/rules?ref=${encodeURIComponent(cfg.ref)}`;
  /** @type {Record<string, string>} */
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (cfg.token !== "") headers["authorization"] = `Bearer ${cfg.token}`;
  let body;
  try {
    body = await withRetries(cfg, "rules listing", () =>
      getOnce(cfg, url, { headers, maxBytes: LIMITS.maxListingBytes }),
    );
  } catch (err) {
    if (err instanceof HttpError && (err.status === 403 || err.status === 429)) {
      err.message += cfg.token === "" ? " (GitHub API rate limit? pass github_token)" : " (GitHub API rate limit or a token that cannot read this repository)";
    }
    throw err;
  }
  let listing;
  try {
    listing = JSON.parse(body.toString("utf8"));
  } catch {
    throw new ManifestError("the rules listing is not valid JSON");
  }
  if (!Array.isArray(listing)) throw new ManifestError("the rules listing is not a directory listing");
  /** @type {string[]} */
  const paths = [];
  for (const entry of listing) {
    if (!isPlainObject(entry) || entry["type"] !== "file") continue;
    paths.push(checkRelativePath(`rules/${typeof entry["name"] === "string" ? entry["name"] : ""}`));
  }
  if (paths.length === 0) throw new ManifestError("the rules listing contains no files");
  if (paths.length + LEGACY_FILES.length > LIMITS.maxFiles) {
    throw new ManifestError(`the rules listing has ${paths.length} files (more than ${LIMITS.maxFiles})`);
  }
  return paths;
}

/**
 * @param {Config} cfg
 * @param {RuntimeFile} file
 * @returns {Promise<Buffer>}
 */
function downloadFile(cfg, file) {
  const maxBytes = file.size ?? LIMITS.maxTotalBytes;
  return withRetries(cfg, file.path, async () => {
    let body;
    try {
      body = await getOnce(cfg, rawUrl(cfg, file.path), { maxBytes });
    } catch (err) {
      if (err instanceof IntegrityError && file.size !== undefined) {
        throw new IntegrityError(`size mismatch (the manifest declares ${file.size} bytes, the server sent more)`);
      }
      throw err;
    }
    if (file.size !== undefined && body.length !== file.size) {
      throw new IntegrityError(`size mismatch (the manifest declares ${file.size} bytes, received ${body.length})`);
    }
    if (file.sha256 !== undefined) {
      const actual = createHash("sha256").update(body).digest("hex");
      if (actual !== file.sha256) {
        throw new IntegrityError(
          `sha256 mismatch (the manifest declares ${file.sha256.slice(0, 12)}..., received ${actual.slice(0, 12)}...)`,
        );
      }
    }
    return body;
  });
}

/**
 * Run `fn` over `items` with bounded concurrency; stops starting new work
 * after the first failure and rethrows it.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, fn) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  /** @type {unknown} */
  let failure;
  let failed = false;
  const worker = async () => {
    while (!failed) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await fn(/** @type {T} */ (items[index]));
      } catch (err) {
        if (!failed) {
          failed = true;
          failure = err;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed) throw failure;
  return results;
}

// ── writing ─────────────────────────────────────────────────────────────────

/**
 * @param {string} root
 * @param {string} target
 */
function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel);
}

/**
 * Write verified files below `runtimeDir`: temp file in the target directory,
 * then rename, so a reader never sees a truncated file. If anything fails
 * midway, what this call created is removed again; files that existed before
 * are never deleted (the directory is the caller's, not ours to clear).
 * @param {string} runtimeDir absolute
 * @param {{ path: string, data: Buffer }[]} entries
 */
async function writeRuntime(runtimeDir, entries) {
  /** Directories this call created (first new ancestor of each mkdir -p). */
  const createdDirs = [];
  /** Files this call put in place, and temp files still in flight. */
  const written = [];
  const temps = new Set();
  try {
    const rootCreated = await mkdir(runtimeDir, { recursive: true });
    if (rootCreated !== undefined) createdDirs.push(rootCreated);
    for (const { path: rel, data } of entries) {
      const target = path.resolve(runtimeDir, ...rel.split("/"));
      if (!isInside(runtimeDir, target)) {
        throw new Error(`${rel} would be written outside the runtime directory`);
      }
      const dirCreated = await mkdir(path.dirname(target), { recursive: true });
      if (dirCreated !== undefined) createdDirs.push(dirCreated);
      const temp = `${target}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
      temps.add(temp);
      await writeFile(temp, data, { flag: "wx", mode: 0o644 });
      await rename(temp, target);
      temps.delete(temp);
      written.push(target);
    }
  } catch (err) {
    for (const file of [...temps, ...written]) await rm(file, { force: true }).catch(() => undefined);
    for (const dir of createdDirs) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

// ── entry points ────────────────────────────────────────────────────────────

/**
 * @param {Config | undefined} cfg
 * @param {string} detail
 * @returns {FetchRuntimeResult}
 */
function failure(cfg, detail) {
  const where = cfg !== undefined ? ` from ${cfg.repo} (ref ${cfg.ref})` : "";
  return {
    ready: false,
    compliifyJs: "",
    version: "",
    reason: oneLine(`could not download the compliify runtime${where}: ${detail}`, 400),
    mode: "none",
    files: 0,
  };
}

/**
 * Download, verify and install the runtime. Never throws.
 * @param {FetchRuntimeOptions} [options]
 * @returns {Promise<FetchRuntimeResult>}
 */
export async function fetchRuntime(options = {}) {
  /** @type {Config | undefined} */
  let cfg;
  try {
    const major = Number((options.nodeVersion ?? process.versions.node).split(".")[0]);
    if (major < 20) {
      return failure(undefined, `Node.js ${options.nodeVersion ?? process.versions.node} is too old - compliify needs Node.js >= 20 (add actions/setup-node)`);
    }
    const config = resolveConfig(options);
    cfg = config;

    const loaded = await loadManifest(config);
    /** @type {RuntimeFile[]} */
    let files;
    let version;
    let verified;
    if (loaded.kind === "manifest") {
      ({ files, version } = loaded);
      verified = true;
    } else {
      config.log(
        `compliify: notice: ${MANIFEST_NAME} not found in ${config.repo}@${config.ref} - falling back to the legacy download WITHOUT checksum verification (the marketplace content predates the manifest).`,
      );
      const rules = await listLegacyRules(config);
      files = [...LEGACY_FILES, ...rules].map((p) => ({ path: p }));
      assertComplete(files.map((f) => f.path));
      version = "unknown";
      verified = false;
    }

    const bodies = await mapLimit(files, config.concurrency, (file) => downloadFile(config, file));
    const total = bodies.reduce((sum, body) => sum + body.length, 0);
    if (total > LIMITS.maxTotalBytes) {
      throw new ManifestError(`the runtime is ${total} bytes (more than ${LIMITS.maxTotalBytes / (1024 * 1024)} MB)`);
    }
    await writeRuntime(
      config.runtimeDir,
      files.map((file, i) => ({ path: file.path, data: /** @type {Buffer} */ (bodies[i]) })),
    );

    return {
      ready: true,
      compliifyJs: path.join(config.runtimeDir, "dist", "compliify.js"),
      version,
      reason: verified
        ? `downloaded ${files.length} files, sha256 verified (plugin ${version}, ${config.repo} ref ${config.ref})`
        : `downloaded ${files.length} files WITHOUT checksum verification (${config.repo} ref ${config.ref} has no ${MANIFEST_NAME} yet)`,
      mode: verified ? "manifest" : "legacy",
      files: files.length,
    };
  } catch (err) {
    return failure(cfg, errorText(err));
  }
}

/**
 * CLI entry: read the environment, run, report the outputs.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<FetchRuntimeResult>}
 */
export async function main(env = process.env) {
  const result = await fetchRuntime({
    ref: env["MARKETPLACE_REF"],
    repo: env["MARKETPLACE_REPO"],
    runtimeDir: env["RUNTIME_DIR"],
    token: env["GITHUB_TOKEN"],
    rawBase: env["COMPLIIFY_RAW_BASE"],
    apiBase: env["COMPLIIFY_API_BASE"],
  });
  setOutputs({
    ready: result.ready,
    compliify_js: result.compliifyJs,
    version: result.version,
    reason: result.reason,
    mode: result.mode,
  });
  process.stderr.write(`compliify: runtime ${result.ready ? "ready" : "NOT ready"} - ${result.reason}\n`);
  return result;
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    setOutputs({
      ready: false,
      compliify_js: "",
      version: "",
      reason: `could not download the compliify runtime: unexpected error (${errorText(err)})`,
    });
  });
}
