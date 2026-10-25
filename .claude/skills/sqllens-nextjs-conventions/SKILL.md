---
name: sqllens-nextjs-conventions
description: Use before writing or changing any Next.js page, layout, route handler, or proxy in SQLLens (Next 16.3.3, React 19.2.8) — covers this repo's patterns and Next 16 breaking changes.
---
# Next.js conventions in SQLLens

Last verified: `22d84fa` · Sources: `package.json`, `node_modules/next/dist/docs/01-app/**`, `src/app/**`

## Versions
next 16.3.3 · react 19.2.8 · @chakra-ui/react 3.37.0 · tailwindcss 4.3.3 · typescript 5.9.3 · path alias `@/*` → `src/*` (`tsconfig.json`).

## Must-know Next 16 facts (read the docs page before coding)
- `middleware` is deprecated → file is `src/proxy.ts` (same level as `src/app`); defaults to Node runtime; `runtime` config not allowed there. Proxy is for optimistic checks only — authorize again in the route handler. Docs: `01-app/01-getting-started/16-proxy.md`, `01-app/03-api-reference/03-file-conventions/proxy.md:23,255,806`.
- Dynamic `params` is a `Promise` — `await params` (`src/app/api/share/[token]/route.ts:6-9`).
- `cookies()` is async: `const store = await cookies()` (`src/app/api/auth/login/route.ts:28`).

## Repo patterns
- Route handlers export `GET`/`POST`/`PUT`, return `NextResponse.json(body, { status })`.
- Server-only modules start with `import "server-only"` (`src/lib/app-config.ts:1`).
- Routes doing fs/model work set `export const runtime = "nodejs"` and `dynamic = "force-dynamic"` (`src/app/api/review/route.ts:8-10`).
- `better-sqlite3` is in `serverExternalPackages` (`next.config.ts:4`).
- Pages are client components (`"use client"`) calling `/api/*` with `fetch(..., { cache: "no-store" })`.
- `layout.tsx` already wraps `AppShell`; pages must NOT wrap it again (bug: `src/app/settings/page.tsx:87`).

## Checks
`npm run lint` · `npx tsc --noEmit` · `npm run build` (D-018).

## Don't
- No server-side `fetch("/api/...")` with relative URLs (bug: `src/app/api/analysis/route.ts:43`) — call the lib function directly.
- No `require()` in TS (`@typescript-eslint/no-require-imports`); use `import`.
- Avoid synchronous `setState` in `useEffect` (lint `react-hooks/set-state-in-effect`, `src/app/manage-models/page.tsx:89`).
