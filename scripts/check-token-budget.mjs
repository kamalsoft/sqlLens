#!/usr/bin/env node
// Enforces token budgets on always-loaded and per-request text.
// Fails (exit 1) on skill bodies, skill descriptions and memory records over budget.
// Prompts in data/prompts are billed per request, so they only warn.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const LIMITS = { skillBodyWords: 600, skillDescriptionChars: 200, memoryRecordWords: 350, promptWords: 1000 };

const words = (text) => text.split(/\s+/).filter(Boolean).length;
const files = (dir, match) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(match).map((f) => path.join(dir, f))
    : [];

const failures = [];
const warnings = [];

for (const dir of fs.readdirSync(path.join(root, ".claude/skills"), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const file = path.join(root, ".claude/skills", dir.name, "SKILL.md");
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  const body = text.replace(/^---[\s\S]*?---/, "");
  const description = (text.match(/^description:\s*(.*)$/m) ?? [, ""])[1];
  const rel = path.relative(root, file);
  if (words(body) > LIMITS.skillBodyWords) failures.push(`${rel}: ${words(body)} words > ${LIMITS.skillBodyWords}`);
  if (description.length > LIMITS.skillDescriptionChars)
    failures.push(`${rel}: description ${description.length} chars > ${LIMITS.skillDescriptionChars}`);
}

for (const file of files(path.join(root, ".team/memory/records"), (f) => f.endsWith(".md"))) {
  const count = words(fs.readFileSync(file, "utf8"));
  if (count > LIMITS.memoryRecordWords)
    failures.push(`${path.relative(root, file)}: ${count} words > ${LIMITS.memoryRecordWords}`);
}

for (const file of files(path.join(root, "data/prompts"), (f) => f.endsWith(".md"))) {
  const count = words(fs.readFileSync(file, "utf8"));
  if (count > LIMITS.promptWords)
    warnings.push(`${path.relative(root, file)}: ${count} words > ${LIMITS.promptWords} (per-request cost)`);
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const f of failures) console.error(`FAIL  ${f}`);
console.log(`token budget: ${failures.length} failure(s), ${warnings.length} warning(s)`);
process.exit(failures.length ? 1 : 0);
