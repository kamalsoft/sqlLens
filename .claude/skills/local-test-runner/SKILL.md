---
name: local-test-runner
description: Runs integration tests locally with structured output filtering, environment validation, and token-efficient log compression.
---

# Local Test Runner Protocol

Use this skill whenever running, debugging, or verifying integration tests locally in this repository.

## Execution Rules
1. **Environment Prerequisite Check:** Ensure required local services (such as Docker, local vector databases, or test containers) are active before kicking off test runs.
2. **Targeted Execution:** Prefer running specific test suites or individual test files over full-suite runs when debugging isolated components (e.g., target the modified module first).
3. **Log Noise Compression:** Filter out repetitive framework startup boilerplate, connection retry spam, and verbose stack traces unless a test failure specifically requires deep forensic inspection.
4. **Failure Analysis Focus:** When a test fails, output only the failing assertion, the relevant code line, and the immediate diff/context needed to fix it.

## Quick Commands
- Run integration tests: `npm run test:integration` (or repository-equivalent test script)
- Run with verbose logging only on failure: Filter test runner output to highlight failure summaries first.