# Design — marketing-home

## Scope and flow

```text
Visitor → / (public product homepage)
  ├─ 登录 → /login
  ├─ 注册 → /signup
  └─ 进入产品 → /home → existing auth guard → /login?callbackUrl=/home when signed out
```

The page belongs to `apps/web/app/page.tsx`. It is a presentational route: it
does not introduce data fetching, client state, a new API, or a new domain
model. `AppShell` keeps `/` fullscreen, so the researcher sidebar and Morris
are never rendered to visitors.

## Composition

1. **Header** — Merism wordmark, restrained product navigation, login and
   registration links. On small screens, the product navigation is hidden but
   the authentication actions remain visible.
2. **Hero** — Researcher-oriented statement of value, one primary CTA
   (`进入产品`) and one secondary in-page link to the workflow section.
3. **Product canvas** — A non-interactive visual of the real workflow:
   study brief → live interview → evidence-backed report. This avoids making
   a mock product interface look functional.
4. **Three-step workflow** — Clear copy for plan, conduct, and understand.
5. **Closing CTA** — Repeats the product-entry and registration paths without
   inventing pricing or team concepts.

## Visual rules

- Use `mauve-200` only as the signature hero/product surface; use white inner
  cards and mauve-tinted shadows from the existing token system.
- Use semantic font roles: `font-display` for editorial headings,
  `font-reading` for explanatory text, and `font-ui` for navigation and
  labels.
- Buttons use the existing primary (mauve) and outline (white + ink border)
  treatment. No black fills, gradients, raw colors, or stock-photo imagery.
- Lucide icons may clarify the three workflow stages. They are decorative when
  adjacent to visible text (`aria-hidden`).

## Reference

The information hierarchy takes the production pattern of a restrained global
navigation, separate authentication links, one dominant hero action, and
scannable product sections from [Vercel's homepage](https://vercel.com/).
Merism differs by presenting a quiet qualitative-research workflow rather than
infrastructure products and by using Mauve Quiet tokens instead of Vercel's
monochrome brand treatment.

## Verification

- Render the root page and assert its navigation targets and primary workflow
  copy.
- Run Web lint, typecheck, and production build.
- Inspect the route in a browser at desktop and mobile widths; verify all links
  can receive keyboard focus and no mock interview copy remains.

