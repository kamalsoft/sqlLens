/**
 * Finds the first balanced JSON object in model output that passes `validate`.
 * Model output is untrusted: every candidate goes through the validator.
 */
export function extractJson<T>(
  text: string,
  validate: (value: unknown) => T,
  options: { finished?: boolean } = {},
): T {
  const candidates: string[] = [];

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;

    let depth = 0;
    let quoted = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const character = text[index];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        quoted = !quoted;
        continue;
      }
      if (!quoted && character === "{") depth += 1;
      if (!quoted && character === "}") depth -= 1;

      if (!quoted && depth === 0) {
        candidates.push(text.slice(start, index + 1));
        break;
      }
    }
  }

  // Report the error for the largest candidate (the model's main object),
  // not for whichever nested object happened to be tried last.
  let reason = "No complete JSON object found";
  let reasonLength = -1;

  for (const candidate of candidates) {
    try {
      return validate(parseLenient(candidate));
    } catch (error) {
      if (candidate.length > reasonLength) {
        reason = errorMessage(error);
        reasonLength = candidate.length;
      }
    }
  }

  // Last resort: the answer ends with `}` but the main object never balanced,
  // usually an unterminated string. Close what is open and validate that.
  const closed = autoClosed(text, options.finished === true);
  if (closed) {
    try {
      return validate(parseLenient(closed));
    } catch (error) {
      reason = errorMessage(error);
    }
  }

  throw new Error(`${reason}; response ended with: ${text.slice(-300)}`);
}

/**
 * Only for answers the model finished: the text ends with `}` (optionally in a
 * code fence), or the caller knows generation stopped on its own (`finished`)
 * and only a final string value is left open. A cut-off answer is never
 * auto-closed: that would turn a partial review into one that looks complete.
 */
function autoClosed(text: string, finished: boolean): string | null {
  const trimmed = text.replace(/```\s*$/, "").trimEnd();
  const start = trimmed.indexOf("{");
  if (start === -1 || !hasUnclosedObject(trimmed)) return null;
  let body: string;
  if (trimmed.endsWith("}")) body = trimmed.slice(start, -1);
  else if (finished) body = trimmed.slice(start);
  else return null;
  // Every list and nested object must already be complete.
  return openDepth(body) === 1 ? closeOpenStructures(body) : null;
}

function openDepth(body: string): number {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const character of body) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") depth -= 1;
  }
  return depth;
}

function closeOpenStructures(body: string): string {
  const stack: string[] = [];
  let quoted = false;
  let escaped = false;

  for (const character of body) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{") stack.push("}");
    else if (character === "[") stack.push("]");
    else if (character === "}" || character === "]") stack.pop();
  }

  let closed = quoted ? `${body.trimEnd()}"` : body.trimEnd().replace(/,$/, "");
  while (stack.length > 0) closed += stack.pop();
  return closed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Small models often emit near-JSON: raw newlines/tabs inside strings (e.g. a
 * rewritten procedure), `//` or block comments, and trailing commas. Repair
 * those outside/inside strings as appropriate, then parse strictly.
 */
function parseLenient(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch (error) {
    const repaired = repairJson(candidate);
    if (repaired === candidate) throw error;
    return JSON.parse(repaired);
  }
}

const VALID_ESCAPES = '"\\/bfnrtu';
const NAMED_ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };

function repairJson(text: string): string {
  let out = "";
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") {
        const next = text[index + 1] ?? "";
        // `\` + whitespace is a line continuation: drop the backslash. Any
        // other invalid escape (`\d`) keeps the backslash as a literal.
        if (/\s/.test(next)) continue;
        if (!VALID_ESCAPES.includes(next)) {
          out += "\\\\";
          continue;
        }
        escaped = true;
      } else if (character === '"') quoted = false;
      else if (character < " ") {
        out += NAMED_ESCAPES[character] ?? `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
        continue;
      }
      out += character;
      continue;
    }

    // A value followed directly by another value is missing its comma:
    // `"a" "b"`, `} {`, `] [` can never be valid JSON without one.
    if ((character === '"' || character === "{" || character === "[") && /["}\]]\s*$/.test(out)) {
      out += ",";
    }

    if (character === '"') {
      quoted = true;
    } else if (character === "/" && text[index + 1] === "/") {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end - 1;
      continue;
    } else if (character === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 1;
      continue;
    } else if (character === "," && /^\s*[}\]]/.test(text.slice(index + 1))) {
      continue;
    }
    out += character;
  }
  return out;
}

/** True when the first `{` in the text is never closed (output was cut off). */
export function hasUnclosedObject(text: string): boolean {
  const start = text.indexOf("{");
  if (start === -1) return false;

  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === "{") depth += 1;
    else if (!quoted && character === "}" && --depth === 0) return false;
  }
  return true;
}

/**
 * True when model output looks stuck in a loop: its last 120 characters
 * already appeared earlier, or a substantial line repeats 5+ times near the end.
 */
export function looksRepetitive(text: string): boolean {
  const probe = text.slice(-120).trim();
  if (probe.length >= 40 && text.slice(0, -120).includes(probe)) return true;

  const counts = new Map<string, number>();
  for (const line of text.slice(-2000).split("\n")) {
    const key = line.trim();
    if (key.length < 12) continue;
    const count = (counts.get(key) ?? 0) + 1;
    if (count >= 5) return true;
    counts.set(key, count);
  }
  return false;
}

/**
 * For an answer cut off by the token limit inside its final
 * `rewrittenProcedure` string (with everything before it complete), returns
 * the answer with that partial rewrite replaced by "". Otherwise null.
 */
export function dropTruncatedRewrite(text: string): string | null {
  const start = text.indexOf("{");
  const matches = [...text.matchAll(/"rewrittenProcedure"\s*:\s*"/g)];
  const last = matches[matches.length - 1];
  if (start === -1 || !last || last.index === undefined || last.index < start) return null;

  let escaped = false;
  for (const character of text.slice(last.index + last[0].length)) {
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') return null; // the string was closed: not this case
  }

  const before = text.slice(start, last.index);
  return openDepth(before) === 1 ? `${before}"rewrittenProcedure": ""}` : null;
}

const REWRITE_OPEN = "<rewritten_procedure>";
const REWRITE_CLOSE = "</rewritten_procedure>";

/**
 * Splits an answer into its JSON part and the plain-SQL rewrite the prompts
 * ask for after the JSON, between <rewritten_procedure> tags. The tag only
 * counts once the JSON object before it is complete. `closed` is false when
 * the closing tag is missing (the answer ended inside the rewrite).
 */
export function splitRewriteBlock(text: string): { json: string; rewrite: string | null; closed: boolean } {
  const open = text.toLowerCase().indexOf(REWRITE_OPEN);
  const before = open === -1 ? "" : text.slice(0, open);
  if (open === -1 || !before.includes("{") || hasUnclosedObject(before)) {
    return { json: text, rewrite: null, closed: true };
  }
  const after = text.slice(open + REWRITE_OPEN.length);
  const close = after.toLowerCase().indexOf(REWRITE_CLOSE);
  const body = close === -1 ? after : after.slice(0, close);
  const rewrite = body.replace(/^\s*```[a-z]*\s*$/gim, "").trim();
  return { json: before, rewrite, closed: close !== -1 };
}
