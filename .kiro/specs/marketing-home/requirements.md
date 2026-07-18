# Requirements — marketing-home

## Objective

Replace the root-route mock interview renderer with Merism's public product
homepage. It must help a prospective researcher understand the product,
provide visible login and registration routes, and give an existing researcher
a direct route into the workspace.

## Acceptance criteria

- `GET /` renders no mock question controls, mock session data, or preview-only
  copy.
- The header exposes `登录` (`/login`) and `注册` (`/signup`) as accessible
  navigation links.
- The primary action routes to `/home`; the existing route guard continues to
  redirect signed-out visitors to `/login?callbackUrl=/home`.
- The page explains the researcher workflow: design a study, run anonymous
  AI-led interviews, then review evidence-backed findings.
- The page gives prospective researchers enough detail to understand how a
  research brief guides the interview and how a conclusion returns to a direct
  interview quote.
- `/interview?link=...` remains the anonymous interviewee entry point and is
  not linked as a generic product CTA.
- The layout is responsive at 320px, 768px, 1024px, and 1440px, uses only
  existing Mauve Quiet tokens, and has keyboard-accessible links.

## Boundaries

- No Appwrite schema, auth protocol, Function, agent, or contract changes.
- No new dependency, new icon library, analytics, pricing, or team concepts.
- Do not reuse `MOCK_RUNTIME_QUESTIONS`, `useInterviewSession`, or question
  renderer components from the removed root preview.

## Commands

- Typecheck: `pnpm -F @merism/web typecheck`
- Lint: `pnpm -F @merism/web lint`
- Production build: `pnpm -F @merism/web build`
