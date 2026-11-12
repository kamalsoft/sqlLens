# Security Policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately through GitHub's "Report a vulnerability" (Security advisories) on this repository, with the steps to reproduce, the affected version or commit, and the impact you expect. Never include real credentials, tokens or production data in a report.

You should get an acknowledgement within 5 working days. Fixes are made on a branch, reviewed by the Security reviewer, and released with a changelog entry.

## Supported versions

Only the latest `main` is supported.

## Scope and design

SQLLens is a local-first tool meant to run on `localhost`. How it protects access, credentials, SQL and model files, what data it keeps, and the known gaps are in [docs/security.md](docs/security.md).
