// Helpers shared by the compliify action scripts (fetch-runtime, ingest,
// build-comment, finalize). Zero dependencies, Node >= 20.
//
// Everything that crosses into GitHub's line-based channels ($GITHUB_OUTPUT,
// workflow commands, the step log) goes through `oneLine`: a value with a
// newline in it could otherwise append an output of its own (`ready=true`).
import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Cut `text` to at most `max` UTF-16 units without splitting a surrogate
 * pair (a lone surrogate cannot be stored by Postgres or encoded as UTF-8).
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function truncate(text, max) {
  if (text.length <= max) return text;
  let cut = max;
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return text.slice(0, cut);
}

/**
 * Collapse any value to one printable line: control characters and line
 * breaks become spaces, runs of whitespace collapse, the result is trimmed
 * and cut to `max` characters (with a trailing ellipsis when cut).
 * @param {unknown} text
 * @param {number} [max]
 * @returns {string}
 */
export function oneLine(text, max = 300) {
  const clean = String(text ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${truncate(clean, max - 1)}…` : clean;
}

/**
 * Append `name=value` lines to $GITHUB_OUTPUT, or print them to stdout when
 * no output file is configured (local runs). Values are forced to one line.
 * Never throws: a broken output file falls back to stdout.
 * @param {Record<string, string | number | boolean | undefined>} outputs
 * @param {{ file?: string | undefined, write?: (text: string) => void }} [target]
 */
export function setOutputs(outputs, target = {}) {
  const file = "file" in target ? target.file : process.env["GITHUB_OUTPUT"];
  const write = target.write ?? ((text) => void process.stdout.write(text));
  const text = Object.entries(outputs)
    .map(([name, value]) => `${name}=${oneLine(value, 1000)}\n`)
    .join("");
  if (file !== undefined && file !== "") {
    try {
      appendFileSync(file, text);
      return;
    } catch (err) {
      process.stderr.write(
        `compliify: cannot write ${file}: ${oneLine(errorText(err))} - printing the outputs instead\n`,
      );
    }
  }
  write(text);
}

/**
 * Whether the module with `metaUrl` is the script node was started with.
 * `import.meta.url === pathToFileURL(argv[1]).href` is the whole test; the
 * realpath comparison only rescues a symlinked path (macOS /var, a linked
 * checkout), where that string comparison would be false and the script
 * would silently do nothing.
 * @param {string} metaUrl
 * @param {string | undefined} [argv1]
 * @returns {boolean}
 */
export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (argv1 === undefined || argv1 === "") return false;
  if (metaUrl === pathToFileURL(argv1).href) return true;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

/**
 * Human wording for a thrown value; for a failed `fetch` the underlying
 * cause (ECONNREFUSED, ENOTFOUND, a TLS error) instead of "fetch failed".
 * @param {unknown} err
 * @returns {string}
 */
export function errorText(err) {
  if (err instanceof Error) {
    const cause = /** @type {{ code?: unknown, message?: unknown } | undefined} */ (err.cause);
    if (cause !== undefined && cause !== null) {
      const detail = typeof cause.code === "string" ? cause.code : cause.message;
      if (typeof detail === "string" && detail !== "") return `${err.message} (${detail})`;
    }
    return err.message;
  }
  return String(err);
}

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/**
 * Make text that may carry repository content (a validation message that
 * names a fact key, the last line of a failed scan) safe for Markdown prose
 * and table cells: one line, and nothing that could open a link, an image,
 * a code span, HTML, emphasis or a table cell. GitHub also turns bare URLs,
 * `www.` hosts and e-mail addresses into links and `@name` / `#123` into
 * pings and issue links; a zero-width space inside `://`, after `www`, before
 * the `@` of an address and after a mention or issue sign defuses each.
 * Underscores, parentheses, ampersands and a `@` or `#` that follows a word
 * character are left alone so identifiers such as ANTHROPIC_API_KEY and
 * `abc#1` stay readable.
 * @param {unknown} text
 * @param {number} [max]
 * @returns {string}
 */
export function mdText(text, max = 300) {
  return oneLine(text, max)
    .replace(/[\\`*[\]<>~|]/g, "\\$&")
    .replace(/:\/\//g, `:${ZERO_WIDTH_SPACE}//`)
    .replace(/\bwww\./gi, (match) => `${match.slice(0, 3)}${ZERO_WIDTH_SPACE}.`)
    .replace(/(^|[^\w])([@#])/g, `$1$2${ZERO_WIDTH_SPACE}`)
    .replace(/([\w.+-])@(?=[\w-]+\.[\w-])/g, `$1${ZERO_WIDTH_SPACE}@`);
}

/**
 * Workflow-command value escaping (`::warning::...`).
 * @param {string} text
 * @returns {string}
 */
export function commandText(text) {
  return oneLine(text, 1000).replace(/%/g, "%25");
}
