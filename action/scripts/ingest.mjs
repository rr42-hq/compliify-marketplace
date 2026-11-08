#!/usr/bin/env node
// Builds the ingest bundle from .compliify/facts.json and POSTs it to
// <server_url>/v1/ingest.
//
// The facts file is snake_case on disk; the ingest API takes camelCase DTOs
// and only ACTIVE facts (the server rejects more than 1000 facts, which an
// ever-growing superseded history would eventually reach).
//
// On top of the facts the bundle carries SOURCE SNIPPETS: for each fact that
// cites `path/to/file.ts:LINE` (and each open-question evidence entry) up to
// 7 lines around the cited line, so a reviewer in the console sees the code
// without a checkout. These lines leave the repository and are stored in the
// compliify database, so the reading is paranoid:
//   - only files of the checked-out workspace, by a relative path without
//     `..`, whose realpath is still inside the workspace (no symlink escape);
//   - never `.git`, `.env*`, key material, credential files (see SECRET_FILE);
//   - regular files of at most 1 MB without NUL bytes;
//   - never for `controls.secrets_in_code` (that fact exists because there is
//     a secret on the cited line);
//   - every emitted line is redacted BEFORE it is truncated, so a secret cut
//     in half by the truncation cannot survive as a prefix.
//
// Observe mode: the script always exits 0. It writes
// ${RUNNER_TEMP}/compliify-ingest-status.json
//   { ok, httpStatus, message, factsSent, evidenceAttached }
// for the action's final step, which turns a failure into a visible message.
//
// Environment: COMPLIIFY_SERVER_URL, COMPLIIFY_TOKEN, COMMIT_SHA, REPO,
// BRANCH, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_WORKSPACE, RUNNER_TEMP,
// and COMPLIIFY_SNIPPETS ("false" keeps source lines out of the bundle; the
// facts, their file:line references and the commit still go).
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { errorText, isMain, oneLine, sleep, truncate } from "./lib.mjs";

export const STATUS_FILE_NAME = "compliify-ingest-status.json";
const SECRETS_FACT_KEY = "controls.secrets_in_code";
const REDACTED = "[redacted]";

/**
 * @param {number} n
 * @param {string} noun
 */
const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Limits of the snippet feature (server contract: 1..15 lines, <= 240 chars per line, file <= 300). */
export const LIMITS = Object.freeze({
  contextLines: 3,
  maxLines: 15,
  maxLineLength: 240,
  maxFilePath: 300,
  maxFileBytes: 1024 * 1024,
  /** Lines longer than this (minified bundles, data blobs) are not shown at all. */
  maxScannedLine: 4000,
  /** The server's default request body limit is 1 MiB; stay below it. */
  maxBodyBytes: 900_000,
  maxCachedFiles: 32,
});

// ── redaction ───────────────────────────────────────────────────────────────

const KEYWORDS = "(?:secret|token|password|passwd|api[_-]?key|authorization)";

/**
 * A name that says "this holds a credential": secret, token, password and its
 * short forms, API / access / account / private / signing / encryption keys,
 * and anything ending in _KEY, -key or Key (`SIGNING_KEY`, `dbKey`). Errs on
 * the side of redacting: a line that mentions one loses its string literals.
 */
const SENSITIVE_NAME = new RegExp(
  [
    "secret",
    "token",
    "passw(?:or)?d",
    "passwd",
    "pwd",
    "passphrase",
    "api[_-]?key",
    "apikey",
    "private[_-]?key",
    "access[_-]?key",
    "account[_-]?key",
    "encryption[_-]?key",
    "signing[_-]?key",
    "credential",
    "authorization",
    "bearer",
    "(?<![a-z])pass(?![a-z])",
    "(?<=[A-Za-z0-9][_-])key(?![a-z])",
    "(?<=[a-z])Key(?![a-z])",
  ].join("|"),
  "i",
);

/** A quoted string literal of at least `n` characters (escapes allowed), content captured. */
const quoted = (/** @type {number} */ n, flags = "g") => new RegExp(`(["'\x60])((?:\\\\.|(?!\\1)[^\\\\\\n]){${n},})\\1`, flags);

/**
 * What may sit between a credential name and the literal that is its value:
 * the rest of the identifier, a closing quote or bracket, a type annotation,
 * and an assignment or argument separator. Anything else (another
 * identifier, a call) means the literal belongs to something else:
 * `apiKey: process.env.KEY, baseURL: "https://api.openai.com/v1"` keeps its URL.
 */
const VALUE_GAP = /^[A-Za-z0-9_$.-]*["'\x60]?\]?\s*(?::\s*[A-Za-z0-9_<>[\]|. ]+?)?\s*(?:=>|:=|===?|=|:|,|\()\s*/;

/**
 * What a string literal is replaced with after a credential name. Left as it
 * is: a template that interpolates (`Bearer ${token}`, `{{ password }}`,
 * `%(password)s`) - a reference, not a value - and a bare prefix word such as
 * `"Bearer "` or `"Basic "`.
 * @param {string} whole
 * @param {string} quote
 * @param {string} content
 * @returns {string}
 */
function literalRedactor(whole, quote, content) {
  if (/\$\{|#\{|\{\{|%[sd]|%\(|\$[A-Za-z_]/.test(content)) return whole;
  if (/^[A-Za-z]+ $/.test(content)) return whole;
  return `${quote}${REDACTED}${quote}`;
}

/** Token formats that identify themselves (replaced in place). */
const TOKEN_PATTERNS = [
  /(?:AKIA|ASIA)[0-9A-Z]{16}/g, // AWS access key ids
  /gh[pousr]_[A-Za-z0-9_]{8,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{8,}/g, // GitHub fine-grained tokens
  /\bsk-[A-Za-z0-9_-]{20,}/g, // OpenAI / Anthropic style keys
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, // Stripe secret keys
  /xox[baprs]-[A-Za-z0-9-]+/g, // Slack tokens
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API keys
  /\bnpm_[A-Za-z0-9]{30,}/g, // npm tokens
  /\bglpat-[A-Za-z0-9_-]{15,}/g, // GitLab tokens
  /\bhf_[A-Za-z0-9]{30,}/g, // Hugging Face tokens
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, // SendGrid keys
  /hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9/_-]{8,}/g, // Slack webhooks
  /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{8,}/g, // Discord webhooks
  /\bshp(?:at|ss|ca|pa)_[a-f0-9]{32}\b/g, // Shopify tokens
  /\bdapi[a-f0-9]{32}\b/g, // Databricks tokens
  /\bkey-[0-9a-f]{32}\b/g, // Mailgun keys
  /\bSK[0-9a-f]{32}\b/g, // Twilio API keys
  /\b(?:AccountKey|SharedAccessKey|SharedAccessSignature|Sig)=[A-Za-z0-9+/=%_-]{16,}/g, // Azure connection strings
  // JWT-looking: header.payload.signature (bounded quantifiers keep a hostile line cheap)
  /eyJ[A-Za-z0-9_-]{0,1000}\.[A-Za-z0-9_-]{1,4000}\.[A-Za-z0-9_-]{0,1000}/g,
];

/** The token after "Bearer " goes; the word stays so the line still reads. */
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi;

/**
 * `Authorization: Basic dXNlcjpwYXNz` (and Token, Digest, Negotiate): the
 * credential of an authorization header goes. "Basic" alone is an ordinary
 * word, so the header name has to be there.
 */
const AUTH_HEADER =
  /(\bauthorization["']?\s*[:=]\s*["']?(?:Basic|Token|Digest|Negotiate)\s+)[A-Za-z0-9+/=._~-]{6,}/gi;

/**
 * `?api_key=abc123`, `Password=Pa55w0rd;` inside a URL or a connection string.
 * A value that starts a template (`${...}`) is a reference, not a secret, and
 * is not matched.
 */
const INLINE_PARAMETER =
  /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|pwd)=)[A-Za-z0-9+/=_.~%!@#^*-]{6,}/gi;

/** `?token=...`, `&client_secret=...`, `;apikey=...`: a credential in a query string, whatever the name around the word. */
const QUERY_SECRET =
  /([?&;][A-Za-z0-9_.-]*(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|apikey|access[_-]?key|auth|signature|credential|sig)[A-Za-z0-9_.-]*=)(?!\$|\{|%7B|%24|\[redacted\])[^&;\s"'\x60<>)]+/gi;

/** `X-Api-Key: abc123`, `Private-Token: ...`: an HTTP header that carries one. */
const KEY_HEADER =
  /(\b(?:x-[a-z-]*(?:key|token|secret|auth)[a-z-]*|api-key|private-token|ocp-apim-subscription-key)["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi;

/** `curl -u user:pass`, `--user user:pass`. */
const CURL_USER = /(\bcurl\b[^\n]*?\s(?:-u|--user)[\s=]+["']?)[^\s"']+/gi;

/**
 * Environment-style lines (`export DB_PASSWORD=...`, `ENV SIGNING_KEY=...`,
 * `- API_TOKEN=...`): an upper-case name that ends in or contains a credential
 * word, and everything after the `=` goes unless it is a reference (`$VAR`,
 * `${VAR}`, `$(cmd)`).
 */
const ENV_ASSIGNMENT =
  /^(\s*(?:export\s+|set\s+|ENV\s+|ARG\s+|-\s+)?[A-Z0-9_]*(?:PASS|PWD|SECRET|TOKEN|KEY|CREDENTIAL|AUTH)[A-Z0-9_]*\s*=\s*)(?!\$\{|\$\(|\$[A-Za-z_]|["'\x60]|\[redacted\])\S.*$/;

/** `scheme://user:PASSWORD@host`: only the password goes. */
const URL_CREDENTIALS = /(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:/@"'<>]*:)[^\s/"'<>]+(@)/g;

/**
 * `password = "hunter2hunter2"`, `"api_key": 'abc...'`, `DB_PASSWORD: "..."`:
 * a secret-named key assigned a quoted literal of 8+ characters. The value
 * goes, key and quotes stay.
 */
const QUOTED_ASSIGNMENT = new RegExp(
  `(${KEYWORDS}[A-Za-z0-9_-]{0,40}["']?\\s*[:=]\\s*)(["'])(?:(?!\\2)[^\\n]){8,}\\2`,
  "gi",
);

/**
 * The same without quotes, for env files, YAML and compose files
 * (`POSTGRES_PASSWORD: supersecret`, `- API_KEY=abcd1234`). Only a whole-line
 * `key: value` / `key=value` with one bare token of 8+ characters counts, so
 * ordinary code (`apiKey: process.env.KEY,`, `token: string;`) is untouched.
 */
const BARE_ASSIGNMENT = new RegExp(
  `^(\\s*(?:export\\s+|-\\s+)?[A-Za-z0-9_.-]*${KEYWORDS}[A-Za-z0-9_.-]*\\s*[:=]\\s*)[^\\s"'\`$<>{}()\\[\\],;#]{8,}(\\s*(?:#.*)?)$`,
  "i",
);

/** A line that opens (or is) a PEM private key block. */
const PEM_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/;
const PEM_END = /-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/;

/**
 * A credential name followed - directly, see VALUE_GAP - by a string literal:
 * the literal goes, in whatever language the line is written. One name, one
 * literal; the rest of the line (an endpoint, a model id) stays as evidence.
 * @param {string} line
 * @returns {string}
 */
function redactNamedLiterals(line) {
  let result = "";
  let rest = line;
  for (;;) {
    const name = SENSITIVE_NAME.exec(rest);
    if (name === null) return result + rest;
    const from = name.index + name[0].length;
    const tail = rest.slice(from);
    const gap = VALUE_GAP.exec(tail);
    const literal = gap === null ? null : quoted(6, "y").exec(tail.slice(gap[0].length));
    if (gap === null || literal === null) {
      // Not a value: look for the next name after this one.
      result += rest.slice(0, from);
      rest = tail;
      continue;
    }
    const whole = literal[0];
    result += rest.slice(0, from) + gap[0] + literalRedactor(whole, /** @type {string} */ (literal[1]), /** @type {string} */ (literal[2]));
    rest = tail.slice(gap[0].length + whole.length);
  }
}

/**
 * Replace the secret-looking parts of one line with `[redacted]`. PEM blocks
 * are line-state and handled by `pemMask` instead.
 * @param {string} line
 * @returns {string}
 */
export function redactLine(line, afterSensitive = false) {
  let out = line;
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED);
  out = out.replace(BEARER, `$1${REDACTED}`);
  out = out.replace(AUTH_HEADER, `$1${REDACTED}`);
  out = out.replace(URL_CREDENTIALS, `$1${REDACTED}$2`);
  out = out.replace(INLINE_PARAMETER, `$1${REDACTED}`);
  out = out.replace(QUERY_SECRET, `$1${REDACTED}`);
  out = out.replace(KEY_HEADER, `$1${REDACTED}`);
  out = out.replace(CURL_USER, `$1${REDACTED}`);
  out = out.replace(QUOTED_ASSIGNMENT, `$1$2${REDACTED}$2`);
  out = out.replace(BARE_ASSIGNMENT, `$1${REDACTED}$2`);
  out = out.replace(ENV_ASSIGNMENT, `$1${REDACTED}`);
  // Whatever the shape of the code: a string literal that follows a credential
  // name on the same line goes. (`const apiKey: string = "..."`,
  // `define('DB_PASSWORD', '...')`, `'password' => '...'`, `password := "..."`,
  // `config["apiKey"] = "..."`.)
  out = redactNamedLiterals(out);
  // A credential name at the end of the line above (`- name: DB_PASSWORD`,
  // `const token =`): the value is on this one.
  if (afterSensitive) {
    out = out.replace(quoted(3), literalRedactor);
    out = out.replace(/^(\s*(?:-\s+)?[A-Za-z0-9_.-]+\s*[:=]\s*)[^\s"'\x60$<>{}[\]#].*$/, `$1${REDACTED}`);
    out = out.replace(/^(\s*)[^\s"'\x60$<>{}[\]#:=][^\s:=]{5,}(\s*[,;]?)$/, `$1${REDACTED}$2`);
  }
  return out;
}

/**
 * Whether a line names a credential - the line below it then holds its value
 * more often than not.
 * @param {string} line
 */
export function namesCredential(line) {
  return SENSITIVE_NAME.test(line);
}

/**
 * Which lines belong to a PEM private key block (the BEGIN and END lines and
 * everything between them, also when the cited line is deep inside the block
 * and the markers are outside the window).
 * @param {string[]} lines
 * @returns {boolean[]}
 */
export function pemMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let inside = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = /** @type {string} */ (lines[i]);
    if (PEM_BEGIN.test(line)) {
      mask[i] = true;
      inside = !PEM_END.test(line);
    } else if (inside) {
      mask[i] = true;
      if (PEM_END.test(line)) inside = false;
    }
  }
  return mask;
}

/**
 * Replace unpaired surrogates (Postgres cannot store them).
 * @param {string} text
 * @returns {string}
 */
function wellFormed(text) {
  return text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
}

/**
 * One source line, ready to leave the repository: redacted, cleaned of
 * control characters, then (and only then) cut to the line limit.
 * @param {string} line
 * @param {boolean} inPemBlock
 * @param {boolean} [afterSensitive] the line above names a credential
 * @returns {string}
 */
export function safeLine(line, inPemBlock, afterSensitive = false) {
  if (inPemBlock) return REDACTED;
  if (line.length > LIMITS.maxScannedLine) return "[line omitted: too long]";
  const redacted = redactLine(line, afterSensitive);
  // eslint-disable-next-line no-control-regex
  const clean = redacted.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trimEnd();
  return wellFormed(truncate(clean, LIMITS.maxLineLength));
}

// ── what may be read ────────────────────────────────────────────────────────

/**
 * Files that hold credentials, by name (mirrors packages/cli/src/hook/
 * relevance.ts SECRET_FILE, which keeps them away from the extraction):
 * a real `.env*` (only .example/.sample/.template are safe), key material,
 * Terraform variable files, and data files named like what they contain.
 */
const SECRET_FILE =
  /(^|\/)\.env(?!\.(?:example|sample|template)$)[^/]*$|\.(env|tfvars|pem|p12|pfx|p8|ppk|key|jks|keystore|kdbx)$|(^|\/)id_(rsa|dsa|ecdsa|ed25519)$|(secret|credential|password)[^/]*\.(ya?ml|json|toml|ini|conf|properties|txt|env|tfvars)$/i;
const SECRET_NAME = /^(\.npmrc|\.netrc|\.pgpass|\.git-credentials|\.pypirc|\.dev\.vars|\.htpasswd|\.s3cfg|\.boto|\.my\.cnf|\.dockercfg|credentials|kubeconfig)$/i;
const SECRET_STATE = /\.tfstate(\.backup)?$/i;
const SECRET_DIRS = new Set([".git", ".ssh", ".aws", ".gnupg", ".docker", ".kube", "secrets", "secret", ".secrets"]);

/**
 * @param {string} rel workspace-relative path with `/` separators
 * @returns {boolean}
 */
export function isDeniedPath(rel) {
  const segments = rel.split("/");
  const name = /** @type {string} */ (segments[segments.length - 1]);
  return (
    // Case-insensitive: `.GIT/config` is the same directory on a case-folding file system.
    segments.slice(0, -1).some((s) => SECRET_DIRS.has(s.toLowerCase())) ||
    SECRET_NAME.test(name) ||
    SECRET_STATE.test(name) ||
    SECRET_FILE.test(rel)
  );
}

/**
 * Normalise a cited file to a workspace-relative `/` path, or null when it
 * cannot be a plain path inside the workspace.
 * @param {unknown} file
 * @returns {string | null}
 */
export function cleanRelativePath(file) {
  if (typeof file !== "string" || file === "" || file.length > LIMITS.maxFilePath) return null;
  if (file.includes("\0")) return null;
  const normalized = file.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return null;
  const segments = normalized.split("/");
  if (segments.includes("..")) return null;
  const parts = segments.filter((s) => s !== "" && s !== ".");
  return parts.length === 0 ? null : parts.join("/");
}

/**
 * `src/db.ts:9`, `src/db.ts:6-12` (a range counts as its first line) or
 * `src/db.ts#L9`; anything else cites no line.
 * @param {unknown} source
 * @returns {{ file: string, line: number } | null}
 */
export function parseSource(source) {
  if (typeof source !== "string") return null;
  const match = /^(.+?)(?::|#L)(\d+)(?:-L?\d+)?\s*$/.exec(source.trim());
  if (match === null) return null;
  const line = Number(match[2]);
  if (!Number.isSafeInteger(line) || line < 1) return null;
  return { file: /** @type {string} */ (match[1]), line };
}

/**
 * @param {string} root
 * @param {string} target
 */
function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * @typedef {{ file: string, line: number, startLine: number, lines: string[] }} Snippet
 * @typedef {{ lines: string[], pem: boolean[] }} SourceFile
 */

/**
 * A reader of workspace files that produces redacted snippets. Files are
 * cached (a survey cites the same file for dozens of facts), up to a bound.
 * @param {string} workspace
 */
export function createSourceReader(workspace) {
  const root = path.resolve(workspace);
  /** @type {string | undefined} */
  let realRoot;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = undefined;
  }
  /** @type {Map<string, SourceFile | null>} */
  const cache = new Map();

  /** @param {string} rel @returns {SourceFile | null} */
  function load(rel) {
    if (realRoot === undefined) return null;
    const abs = path.resolve(root, rel);
    if (!isInside(root, abs)) return null;
    let real;
    try {
      real = realpathSync(abs);
    } catch {
      return null;
    }
    if (!isInside(realRoot, real)) return null;
    // A symlink inside the workspace may point at a credential file in it.
    if (isDeniedPath(path.relative(realRoot, real).split(path.sep).join("/"))) return null;
    if (cache.has(real)) return cache.get(real) ?? null;

    /** @type {SourceFile | null} */
    let loaded = null;
    let fd;
    try {
      // Look before opening: opening a FIFO would block until someone writes.
      const before = statSync(real);
      if (!before.isFile() || before.size > LIMITS.maxFileBytes) throw new Error("not a readable file");
      fd = openSync(real, "r");
      const stat = fstatSync(fd);
      if (stat.isFile() && stat.size <= LIMITS.maxFileBytes) {
        const buffer = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < stat.size) {
          const n = readSync(fd, buffer, offset, stat.size - offset, offset);
          if (n === 0) break;
          offset += n;
        }
        const data = buffer.subarray(0, offset);
        if (!data.includes(0)) {
          let text = data.toString("utf8");
          if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
          const lines = text.split(/\r\n|\n|\r/);
          if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
          loaded = { lines, pem: pemMask(lines) };
        }
      }
    } catch {
      loaded = null;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    if (cache.size >= LIMITS.maxCachedFiles) cache.delete(/** @type {string} */ (cache.keys().next().value));
    cache.set(real, loaded);
    return loaded;
  }

  return {
    /**
     * The snippet around `line` of `file`, or null when the file may not or
     * cannot be shown (the caller then simply sends no evidence).
     * @param {unknown} file
     * @param {unknown} line
     * @returns {Snippet | null}
     */
    snippet(file, line) {
      const rel = cleanRelativePath(file);
      if (rel === null || typeof line !== "number" || !Number.isSafeInteger(line) || line < 1) return null;
      if (isDeniedPath(rel)) return null;
      const source = load(rel);
      if (source === null || line > source.lines.length) return null;
      const startLine = Math.max(1, line - LIMITS.contextLines);
      const endLine = Math.min(source.lines.length, line + LIMITS.contextLines);
      /** @type {string[]} */
      const lines = [];
      for (let n = startLine; n <= endLine; n += 1) {
        const above = n >= 2 ? /** @type {string} */ (source.lines[n - 2]) : "";
        lines.push(
          safeLine(/** @type {string} */ (source.lines[n - 1]), source.pem[n - 1] === true, namesCredential(above)),
        );
      }
      if (lines.length === 0 || lines.length > LIMITS.maxLines) return null;
      return { file: rel, line, startLine, lines };
    },
  };
}

// ── the bundle ──────────────────────────────────────────────────────────────

/**
 * `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}` when it is a clean https URL.
 * @param {string | undefined} serverUrl
 * @param {string | undefined} repository
 * @returns {string | undefined}
 */
export function repoUrlFrom(serverUrl, repository) {
  if (serverUrl === undefined || repository === undefined) return undefined;
  const base = serverUrl.trim().replace(/\/+$/, "");
  const repo = repository.trim().replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return undefined;
  const url = `${base}/${repo}`;
  // eslint-disable-next-line no-control-regex
  if (!url.startsWith("https://") || url.length > 300 || /[\s\u0000-\u001f\u007f]/.test(url)) return undefined;
  return url;
}

/**
 * Whether source lines may leave the repository. On unless the input is
 * absent; anything but an explicit yes ("false", "no", "0", "off", a typo) is
 * off - a switch meant to keep code in must not fail open.
 * @param {string | undefined} value
 * @returns {boolean}
 */
export function snippetsEnabled(value) {
  if (value === undefined) return true;
  return ["true", "yes", "1", "on"].includes(value.trim().toLowerCase());
}

/**
 * @typedef {{
 *   factFile: any,
 *   workspace: string,
 *   commitSha?: string | undefined,
 *   repo?: string | undefined,
 *   branch?: string | undefined,
 *   repoUrl?: string | undefined,
 *   snippets?: boolean | undefined,
 * }} BuildOptions
 */

/**
 * Build the ingest bundle from a parsed facts.json (snake_case) - camelCase
 * DTOs, active facts only, plus source snippets where they can be shown.
 * @param {BuildOptions} options
 * @returns {Record<string, any>}
 */
export function buildBundle({ factFile, workspace, commitSha, repo, branch, repoUrl, snippets = true }) {
  // With snippets switched off nothing of the workspace is read at all.
  const reader = snippets ? createSourceReader(workspace) : { snippet: () => null };
  const file = factFile ?? {};

  const facts = (Array.isArray(file.facts) ? file.facts : [])
    .filter((/** @type {any} */ f) => f.status !== "superseded")
    .map((/** @type {any} */ f) => {
      const evidence =
        f.key === SECRETS_FACT_KEY
          ? null
          : (() => {
              const cited = parseSource(f.source);
              return cited === null ? null : reader.snippet(cited.file, cited.line);
            })();
      return {
        key: f.key,
        value: f.value,
        provenance: f.provenance,
        ...(f.source !== undefined ? { source: f.source } : {}),
        ...(f.confidence !== undefined ? { confidence: f.confidence } : {}),
        asOf: f.as_of,
        ...(f.by !== undefined ? { by: f.by } : {}),
        ...(f.at !== undefined ? { at: f.at } : {}),
        status: f.status,
        ...(evidence !== null ? { evidence } : {}),
      };
    });

  const openQuestions = (Array.isArray(file.open_questions) ? file.open_questions : []).map(
    (/** @type {any} */ q) => {
      if (typeof q !== "object" || q === null || !Array.isArray(q.evidence)) return q;
      // The lines of a snippet are only ever what the reader read (and
      // redacted): a facts.json is the pull request's own text, and lines,
      // start lines or a commit written into it are not forwarded - a file
      // the reader refuses (a credential file, a path outside the workspace)
      // stays a bare `file:line` reference.
      const evidence = q.evidence
        .map((/** @type {any} */ e) => {
          if (typeof e !== "object" || e === null) return null;
          const snippet = q.key === SECRETS_FACT_KEY ? null : reader.snippet(e.file, e.line);
          if (snippet !== null) return snippet;
          if (typeof e.file !== "string" || e.file === "" || e.file.length > LIMITS.maxFilePath) return null;
          return {
            file: e.file,
            ...(Number.isSafeInteger(e.line) && e.line > 0 ? { line: e.line } : {}),
          };
        })
        .filter((/** @type {unknown} */ e) => e !== null);
      const { evidence: _own, ...rest } = q;
      return evidence.length > 0 ? { ...rest, evidence } : rest;
    },
  );

  return {
    system: file.system,
    commitSha,
    ...(repoUrl !== undefined ? { repoUrl } : {}),
    // Extra CI context - unknown fields are stripped by older servers.
    repo,
    branch,
    // Self-declared origin, shown in the console history ("pushed locally -
    // not from CI" marks the other kind). Older servers strip the field.
    origin: "ci",
    facts,
    openQuestions,
  };
}

/**
 * Number of snippets in a bundle (facts and open-question evidence).
 * @param {Record<string, any>} bundle
 * @returns {number}
 */
export function countEvidence(bundle) {
  let n = 0;
  for (const f of bundle["facts"] ?? []) if (f.evidence !== undefined) n += 1;
  for (const q of bundle["openQuestions"] ?? []) {
    if (typeof q === "object" && q !== null && Array.isArray(q.evidence)) {
      n += q.evidence.filter((/** @type {any} */ e) => Array.isArray(e?.lines)).length;
    }
  }
  return n;
}

/**
 * Keep the request below the server's body limit by dropping snippets,
 * last fact first, until it fits. Snippets are a nicety; the facts are not.
 * @param {Record<string, any>} bundle mutated
 * @param {number} [maxBytes]
 * @returns {number} how many facts lost their snippet
 */
export function fitBundle(bundle, maxBytes = LIMITS.maxBodyBytes) {
  const facts = /** @type {any[]} */ (bundle["facts"]);
  let size = Buffer.byteLength(JSON.stringify(bundle));
  let dropped = 0;
  for (let i = facts.length - 1; i >= 0 && size > maxBytes; i -= 1) {
    if (facts[i].evidence === undefined) continue;
    size -= Buffer.byteLength(`,"evidence":${JSON.stringify(facts[i].evidence)}`);
    delete facts[i].evidence;
    dropped += 1;
  }
  // Still too big: the open questions' snippets go too, back to bare
  // `file:line` references (last question first).
  const questions = /** @type {any[]} */ (bundle["openQuestions"] ?? []);
  for (let i = questions.length - 1; i >= 0 && size > maxBytes; i -= 1) {
    const q = questions[i];
    if (typeof q !== "object" || q === null || !Array.isArray(q.evidence)) continue;
    const before = Buffer.byteLength(JSON.stringify(q));
    let changed = false;
    q.evidence = q.evidence.map((/** @type {any} */ e) => {
      if (e === null || typeof e !== "object" || e.lines === undefined) return e;
      changed = true;
      dropped += 1;
      return { file: e.file, ...(e.line !== undefined ? { line: e.line } : {}) };
    });
    if (changed) size -= before - Buffer.byteLength(JSON.stringify(q));
  }
  return dropped;
}

/**
 * The size of the request body, for saying plainly when no shortening helps.
 * @param {Record<string, any>} bundle
 * @returns {number}
 */
export function bundleBytes(bundle) {
  return Buffer.byteLength(JSON.stringify(bundle));
}

// ── posting ─────────────────────────────────────────────────────────────────

/**
 * @typedef {{ ok: boolean, httpStatus: number, message: string }} PostResult
 */

/**
 * @param {unknown} body parsed JSON error body
 * @returns {string}
 */
function serverMessage(body) {
  if (typeof body !== "object" || body === null) return "";
  const { message, error } = /** @type {{ message?: unknown, error?: unknown }} */ (body);
  return oneLine(typeof message === "string" ? message : typeof error === "string" ? error : "", 160);
}

/**
 * `text` without the token: an error from the HTTP stack can quote the header
 * it refused, and these messages end up in a public pull request comment.
 * @param {string} text
 * @param {string} token
 * @returns {string}
 */
export function withoutToken(text, token) {
  let out = text;
  for (const part of [token, ...token.split(/\s+/)]) {
    if (part.length >= 6) out = out.split(part).join("[token]");
  }
  return out.replace(/cpfy_[A-Za-z0-9_-]{6,}/g, "[token]");
}

/**
 * POST the bundle. 2xx is success; 5xx and network errors are retried
 * (attempts, baseDelayMs * 2^(n-1) apart); every 4xx is final and explained.
 * Never throws.
 * @param {{
 *   serverUrl: string,
 *   token: string,
 *   bundle: Record<string, any>,
 *   fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => Promise<void>,
 *   attempts?: number,
 *   baseDelayMs?: number,
 *   timeoutMs?: number,
 *   log?: (line: string) => void,
 * }} options
 * @returns {Promise<PostResult>}
 */
export async function postBundle({
  serverUrl,
  token,
  bundle,
  fetchImpl = globalThis.fetch,
  sleep: wait = sleep,
  attempts = 3,
  baseDelayMs = 1000,
  timeoutMs = 30_000,
  log = () => undefined,
}) {
  let url;
  try {
    url = new URL(serverUrl.trim());
  } catch {
    return { ok: false, httpStatus: 0, message: "server_url is not a valid URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, httpStatus: 0, message: "server_url must be an http(s) URL" };
  }
  if (url.protocol === "http:") {
    log("compliify ingest: warning: server_url uses plain http - the API token is sent unencrypted.");
  }
  // One line of printable characters, or it could not be an Authorization header:
  // say so without printing it.
  if (!/^[\x21-\x7e]{1,300}$/.test(token)) {
    return {
      ok: false,
      httpStatus: 0,
      message: "the compliify_token is not a valid API token (one line of printable characters, cpfy_...) - check the COMPLIIFY_TOKEN secret",
    };
  }
  const endpoint = `${url.origin}${url.pathname.replace(/\/+$/, "")}/v1/ingest`;
  const host = url.host;
  const body = JSON.stringify(bundle);

  /** @type {PostResult} */
  let last = { ok: false, httpStatus: 0, message: "no attempt was made" };
  for (let n = 1; n <= attempts; n += 1) {
    let transient = false;
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "user-agent": "compliify-action",
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      log(`compliify ingest: HTTP ${res.status} - ${text.slice(0, 500)}`);
      last = classify(res.status, text, host);
      transient = res.status >= 500;
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      last = {
        ok: false,
        httpStatus: 0,
        message: timedOut
          ? `${host} did not answer within ${timeoutMs / 1000} s`
          : `could not reach ${host}: ${withoutToken(oneLine(errorText(err), 160), token)}`,
      };
      transient = true;
    }
    if (!transient || n === attempts) break;
    await wait(baseDelayMs * 2 ** (n - 1));
  }
  if (!last.ok && last.httpStatus >= 500) {
    last = { ...last, message: `${last.message} (after ${attempts} attempts)` };
  } else if (!last.ok && last.httpStatus === 0 && attempts > 1) {
    last = { ...last, message: `${last.message} (after ${attempts} attempts)` };
  }
  return last;
}

/**
 * @param {number} status
 * @param {string} text
 * @param {string} host
 * @returns {PostResult}
 */
function classify(status, text, host) {
  /** @type {any} */
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (status >= 200 && status < 300) {
    const facts = body?.facts;
    const detail =
      body?.idempotent === true
        ? "already ingested (identical bundle for this commit)"
        : facts !== undefined && typeof facts === "object"
          ? `${plural(facts.added ?? 0, "fact")} added, ${facts.unchanged ?? 0} unchanged, ${facts.superseded ?? 0} superseded`
          : "accepted";
    return { ok: true, httpStatus: status, message: `ingested (HTTP ${status}): ${detail}` };
  }
  if (status >= 300 && status < 400) {
    return {
      ok: false,
      httpStatus: status,
      message: `${host} redirected the request (HTTP ${status}) - set server_url to the final https address, a POST is not followed through a redirect`,
    };
  }
  if (status === 401) {
    const why = serverMessage(body);
    return {
      ok: false,
      httpStatus: 401,
      message: `token rejected - check the COMPLIIFY_TOKEN secret (HTTP 401${why !== "" ? `: ${why}` : ""})`,
    };
  }
  if (status === 422) {
    const issues = Array.isArray(body?.issues) ? body.issues : [];
    const shown = issues
      .slice(0, 5)
      .map((/** @type {any} */ i) => oneLine(`${i?.path ?? "?"}: ${i?.message ?? "invalid"}`, 200));
    const more = issues.length > shown.length ? ` (+${issues.length - shown.length} more)` : "";
    const lead = shown.length > 0 ? shown.join("; ") + more : serverMessage(body) || "the bundle failed validation";
    return { ok: false, httpStatus: 422, message: `the server rejected the bundle (HTTP 422): ${lead}` };
  }
  if (status === 404) {
    return {
      ok: false,
      httpStatus: 404,
      message: `${host} has no /v1/ingest endpoint (HTTP 404) - check server_url`,
    };
  }
  if (status === 413) {
    return { ok: false, httpStatus: 413, message: "the bundle is too large for the server (HTTP 413)" };
  }
  if (status >= 400 && status < 500) {
    const why = serverMessage(body);
    return { ok: false, httpStatus: status, message: `the server answered HTTP ${status}${why !== "" ? `: ${why}` : ""}` };
  }
  return { ok: false, httpStatus: status, message: `server error (HTTP ${status}) from ${host}` };
}

// ── command ─────────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   ok: boolean,
 *   httpStatus: number,
 *   message: string,
 *   factsSent: number,
 *   evidenceAttached: number,
 * }} IngestStatus
 */

/**
 * Run the ingest from an environment. Never throws; the outcome is the
 * returned status (also written to the status file).
 * @param {Record<string, string | undefined>} [env]
 * @param {{ fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, log?: (line: string) => void, baseDelayMs?: number, timeoutMs?: number }} [deps]
 * @returns {Promise<IngestStatus>}
 */
export async function runIngest(env = process.env, deps = {}) {
  const log = deps.log ?? ((line) => void process.stdout.write(`${line}\n`));
  /** @type {IngestStatus} */
  const status = { ok: false, httpStatus: 0, message: "", factsSent: 0, evidenceAttached: 0 };
  try {
    const serverUrl = (env["COMPLIIFY_SERVER_URL"] ?? "").trim();
    const token = (env["COMPLIIFY_TOKEN"] ?? "").trim();
    const workspace = path.resolve(env["GITHUB_WORKSPACE"] || process.cwd());
    const factsPath = path.join(workspace, ".compliify", "facts.json");
    if (serverUrl === "" || token === "") {
      status.message = "server_url and compliify_token must both be set";
    } else if (!existsSync(factsPath)) {
      status.ok = true;
      status.message = "no .compliify/facts.json in this repository - nothing to ingest";
    } else {
      let factFile;
      try {
        factFile = JSON.parse(readFileSync(factsPath, "utf8"));
      } catch (err) {
        throw new Error(`.compliify/facts.json is not valid JSON (${oneLine(errorText(err), 120)})`);
      }
      const bundle = buildBundle({
        factFile,
        workspace,
        commitSha: env["COMMIT_SHA"],
        repo: env["REPO"],
        branch: env["BRANCH"],
        repoUrl: repoUrlFrom(env["GITHUB_SERVER_URL"], env["GITHUB_REPOSITORY"]),
        snippets: snippetsEnabled(env["COMPLIIFY_SNIPPETS"]),
      });
      const dropped = fitBundle(bundle);
      if (dropped > 0) {
        log(`compliify ingest: dropped the source snippets of ${plural(dropped, "location")} to stay below the server's request size limit.`);
      }
      const bytes = bundleBytes(bundle);
      if (bytes > LIMITS.maxBodyBytes) {
        log(
          `compliify ingest: the request is ${Math.round(bytes / 1024)} KiB, more than the server accepts by default (1 MiB), and dropping source lines did not make it smaller - a fact value or an open question is very large.`,
        );
      }
      status.factsSent = bundle["facts"].length;
      status.evidenceAttached = countEvidence(bundle);
      const result = await postBundle({
        serverUrl,
        token,
        bundle,
        log,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
        ...(deps.baseDelayMs !== undefined ? { baseDelayMs: deps.baseDelayMs } : {}),
        ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
      });
      status.ok = result.ok;
      status.httpStatus = result.httpStatus;
      status.message = result.message;
      if (result.ok) {
        log(
          !snippetsEnabled(env["COMPLIIFY_SNIPPETS"])
            ? "compliify ingest: source lines were not sent (send_code_snippets is not true)."
            : `compliify ingest: attached source snippets to ${plural(status.evidenceAttached, "location")} in ${plural(status.factsSent, "fact")}.`,
        );
      }
    }
  } catch (err) {
    status.ok = false;
    status.message = withoutToken(oneLine(errorText(err), 300), (env["COMPLIIFY_TOKEN"] ?? "").trim());
  }
  if (!status.ok) log(`compliify ingest: ${status.message} (observe mode - not failing the build)`);
  try {
    const dir = env["RUNNER_TEMP"] || os.tmpdir();
    writeFileSync(path.join(dir, STATUS_FILE_NAME), `${JSON.stringify(status)}\n`);
  } catch (err) {
    log(`compliify ingest: could not write the status file (${oneLine(errorText(err), 120)})`);
  }
  return status;
}

if (isMain(import.meta.url)) {
  runIngest().catch((err) => {
    process.stderr.write(`compliify ingest: unexpected error (${errorText(err)})\n`);
  });
}
