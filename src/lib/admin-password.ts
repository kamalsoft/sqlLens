/** Rules and key handling for the admin password CLI (scripts/set-admin-password.ts). */

export const MIN_PASSWORD_LENGTH = 12;

/** Why a password is rejected, or null when it is acceptable. */
export function passwordProblem(password: string): string | null {
  return password.length < MIN_PASSWORD_LENGTH
    ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    : null;
}

/** Why the repeat does not match the first entry, or null when it does. */
export function mismatchProblem(first: string, repeat: string): string | null {
  return first === repeat ? null : "Passwords do not match.";
}

export type KeyResult = {
  /** The password typed so far. */
  value: string;
  /** What to write to the terminal: a `*` per character, and erase sequences for backspace. */
  echo: string;
  /** Enter, or Ctrl+C, ended the entry. */
  done: boolean;
  /** Ctrl+C was pressed. */
  cancelled: boolean;
};

/** Applies one chunk of raw terminal input to the password typed so far. */
export function applyKeys(value: string, chunk: string): KeyResult {
  // Arrow keys and other escape sequences start with ESC; they are not typed characters.
  if (chunk.startsWith("\u001b")) return { value, echo: "", done: false, cancelled: false };
  let echo = "";
  for (const ch of chunk) {
    if (ch === "\r" || ch === "\n") return { value, echo, done: true, cancelled: false };
    if (ch === "\u0003") return { value, echo, done: true, cancelled: true };
    if (ch === "\u007f" || ch === "\b") {
      if (value.length > 0) {
        value = value.slice(0, -1);
        echo += "\b \b";
      }
      continue;
    }
    if (ch < " ") continue;
    value += ch;
    echo += "*";
  }
  return { value, echo, done: false, cancelled: false };
}
