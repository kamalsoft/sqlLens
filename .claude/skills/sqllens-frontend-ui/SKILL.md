---
name: sqllens-frontend-ui
description: Use when building SQLLens pages or components under src/app and src/components: useApi calls, loading and error states, forms, styling, client tests.
---
# Frontend UI patterns

Last verified: `b90cda9` · Sources: `src/components/api-client.ts`, `src/components/AppShell.tsx`, `src/components/layout/Navbar.tsx`, `src/components/{audit,review,execute}/`, `src/app/**/page.tsx`, `package.json`

Related: `sqllens-nextjs-conventions` (Next.js 16 rules, read it first for routing and `params` changes).

## Pages
Eleven routes: `/` (overview), `/audit`, `/audit/[id]`, `/compare`, `/execute`, `/login`, `/manage-models`, `/refactor`, `/review`, `/settings`, `/share/[token]`.

## Calling the API
- Use `useApi()` from `src/components/api-client.ts` (12 files already do). It returns `ApiResult<T>`: `ok`, `status`, `data`, `error`, `field`, `details`. It never throws.
- On 401 it redirects to `/login?next=<current path>`. Don't add your own 401 handling.
- For a 400 with `field`, mark that form field as invalid. Show `error` as the message.
- Don't call `fetch` directly unless the file is already doing so (`api-client.ts`, `AppShell.tsx`, `login/page.tsx`).
- Post-login redirects: always pass `next` through `sanitizeNext`. It accepts only same-origin relative paths.

## States every data view needs
- Loading: a visible progress state; disable the submit button while a request is running.
- Error: the `error` text in an alert region (`role="alert"`), with a retry action where a retry makes sense.
- Empty: a clear message, not a blank panel.
- Success: confirm the change in the UI (e.g. the feedback status updated).
- Long jobs (review, refactor, model download): show elapsed time or progress and allow cancel where the API supports it.

## Components
- Mark client components with `"use client"` at the top (20 files do this). Keep server-only modules (`src/lib`, `src/db`) out of client components. Import types from `*-shared.ts` files where they exist.
- Small presentational pieces live in `src/components/<area>/`. Follow the naming of the folder you are in (`ReviewPanel`, `FeedbackControls`).
- Model output and SQL text are displayed as text. Never use `dangerouslySetInnerHTML` for them.

## Styling
- Two systems are in use: Chakra UI (7 files) and plain `className` with CSS (13 files). Use the one the file already uses. Don't mix them in one component.
- Layout must work at phone width (16px side gutter, no horizontal page scroll), and in light and dark mode (`next-themes`).

## Accessibility
- Every input has a label. Errors are linked with `aria-describedby`. Buttons have text, not only an icon.
- Keyboard works for every action. Focus is visible.
- Colour is not the only signal for severity or grade.

## Tests
- Unit and component: Vitest with Testing Library (`npm test`).
- End to end: Playwright (`npm run test:e2e`). Only add an e2e test when the flow matters end to end (login, run, share).
- For a new component, test: loading, error, and success render, and the 401 redirect path through `useApi` (mock `next/navigation`).

## Known issues (don't copy)
- `src/app/**` and `src/components/**` mix two styling systems. Don't add a third.
- `GET /api/appconfig` returns `apiKey` (see `sqllens-api-route-patterns`). Never render or log it in the UI.

## Verify
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Run the app and check the changed page in a browser at phone width and desktop width (`run` skill). Type checks do not prove the UI works.

## Don't
- Don't put secrets, tokens, or raw SQL in `localStorage`.
- Don't add a UI library or a state library for one screen. Use React state and `useApi`.
- Don't call your own API routes from the server with `fetch` (`sqllens-api-route-patterns`).
