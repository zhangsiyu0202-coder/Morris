---
inclusion: always
---

# MerismV2 Design System (Mauve Quiet)

> Single source of truth for visual tokens, typography roles, and Figma-to-code translation rules across the MerismV2 product. Every page, component, and Figma implementation must reference this file. Magic values are forbidden.

## Mood and Intent

MerismV2 is an AI-driven qualitative voice interview platform. The visual language must read as:

- **Quiet, not corporate** — long-form reading and listening surfaces, no marketing-y SaaS gradients
- **Warm-neutral, not cool slate** — every "white" is biased toward warm, every "shadow" is tinted dusty-rose
- **Research-feeling** — typography hierarchy borrows from editorial / academic systems (multi-face), not generic UI sans

The signature surface is **mauve `#D7CFD9`** — a desaturated lavender-grey that anchors all major surfaces.

## Color Tokens

All colors below are defined as Tailwind tokens. Code MUST use the semantic name (e.g. `bg-mauve-200`), never the raw hex.

### Mauve (signature surface)

| Token | Hex / RGBA | Usage |
|---|---|---|
| `mauve-50` | `#F9F6F6` | Warm white. Inner row backgrounds (accordion rows, table zebra). |
| `mauve-100` | `#EAE3EC` | Hover surface for mauve buttons / nav items. |
| `mauve-200` | `#D7CFD9` | **Signature.** Page section cards, hero panels, project cards. |
| `mauve-200/64` | `rgba(215,207,217,0.64)` | Translucent overlay (e.g. floating nav over content). |
| `mauve-400` | `#A78585` | Dusty rose. **Shadow tint only**, never as fill. |

### Ink (text and structural)

| Token | Hex | Usage |
|---|---|---|
| `ink-900` | `#0F172A` | Primary ink. Body text, button fills, primary headings on light surface. |
| `ink-800` | `#1E293B` | Secondary heading. H2-H3 on mauve surface. |
| `ink-600` | `#475569` | Description / muted body. |
| `ink-400` | `#64748B` | Placeholder, disabled-foreground. |
| `ink-200` | `#E2E8F0` | Dividers, table borders, accordion inset rule. |
| `ink-100` | `#F1F5F9` | Subtle field background. |
| `ink-0` | `#FFFFFF` | Inner cards inside mauve sections. Button-on-dark text. |

### Status semantics — monochrome by design

This palette is intentionally **monochrome**. Status (success / warning / destructive / info) is communicated through **icon + copy + container position**, not color. This keeps the product visually quiet and prevents the SaaS-rainbow look.

| Status | Visual treatment |
|---|---|
| Success / Confirmed | `ink-900` text on `mauve-50` surface, with `check` icon. No green. |
| Warning | `ink-900` text on `mauve-100` surface, with `triangle-alert` icon. No amber. |
| Destructive | `ink-900` text on `ink-0` surface, **outlined** with `border border-ink-900`, paired with confirmation copy. No red. Buttons that confirm destruction use `bg-ink-900` (same as primary) but require a Dialog confirmation step. |
| Info / Neutral | `ink-600` text on `mauve-50` surface, with `info` icon. No blue. |

The single exception is form-validation **error text**, which uses `ink-900` italic + an `alert-circle` icon. Inputs in error state get `border-ink-900` (twice the default border weight).

### Forbidden

- Never use Tailwind's default `gray-*`, `zinc-*`, `red-*`, `green-*`, `yellow-*`, `blue-*` palettes. The product is monochrome.
- Never invent a new mauve shade. Add it here first if needed.
- Never use color alone to convey state — always pair with icon + copy.

## Typography

Five typefaces, each with a **fixed semantic role**. Mixing them is intentional and gives the product its editorial character. Code MUST use the semantic class (e.g. `font-display`, `font-reading`), never the family name directly.

| Token | Family | Weight | Role | Where |
|---|---|---|---|---|
| `font-display` | **Inclusive Sans** | 600 | Display headings | Hero titles, page H1, empty-state headlines, section covers |
| `font-reading` | **Inclusive Sans** | 400 | Long-form reading body | Report narrative, transcript content, ADR-like docs |
| `font-ui` | **Inter** | 400 / 500 / 600 | Default UI | All buttons, form labels, navigation, dialog titles, body UI text |
| `font-data` | **Istok Web** | 400 | Tabular / list data | Table cells, file rows, accordion item labels, metadata strips |
| `font-decor` | **Inika** | 400 | Decorative chips / tags | Status pill labels, version tags, taxonomy chips |
| `font-doc-link` | **Inknut Antiqua** | 400 | External doc links | "View docs" buttons, citation links, footnote refs (always with `underline`) |

### Type scale

Use Tailwind utility names. Custom sizes only when matching a specific Figma value the scale cannot express.

| Class | Size / line-height | Tracking | Role |
|---|---|---|---|
| `text-display-xl` | 30 / 36 | -0.225px | H1 on mauve cards (Alert Dialog title size) |
| `text-display-lg` | 24 / 32 | -0.15px | H2 |
| `text-display-md` | 20 / 28 | 0 | H3 / large item headings |
| `text-body-lg` | 20 / 28 | 0 | Description under H1 (Alert Dialog description size) |
| `text-body` | 16 / 24 | 0 | Default UI body |
| `text-body-sm` | 14 / 24 | 0 | Compact button label, helper text |
| `text-caption` | 12 / 16 | 0.05px | Caption, axis labels |

## Shadows (Mauve-tinted)

Shadow color is **always tinted with `mauve-400` (`#A78585`)** at low alpha. This keeps elevation visually consistent with the warm palette. Never use pure-black `rgba(0,0,0,*)` shadows.

| Token | Definition | Usage |
|---|---|---|
| `shadow-xs` | `0 1px 1px rgba(167,133,133,0.06)` | Hairline lift (table row hover). |
| `shadow-sm` | `0 2px 4px rgba(167,133,133,0.08)` | Cards. |
| `shadow` | `0 4px 8px rgba(167,133,133,0.10)` | Default card / popover. |
| `shadow-md` | `0 8px 16px rgba(167,133,133,0.12)` | Floating panels. |
| `shadow-lg` | `0 16px 32px rgba(167,133,133,0.14)` | Modals, dialogs. |
| `shadow-popover` | `0 4px 24px rgba(167,133,133,0.18)` | Popover, menu, tooltip. |
| `inset-divider` | `inset 0 -1px 0 #E2E8F0` | Accordion / list row bottom rule. |

## Radius

| Token | Value | Usage |
|---|---|---|
| `rounded-xs` | 4px | Inline pill, micro-tag |
| `rounded-sm` | 6px | Accordion rows, table cells, small inputs |
| `rounded` | 8px | Default. Buttons (Continue), inner cards, inputs |
| `rounded-md` | 12px | Mid panels |
| `rounded-lg` | 16px | Cards |
| `rounded-xl` | 20px | Hero / section mauve cards |
| `rounded-full` | 9999px | Avatars, pill buttons |

Note: 7px (Alert Dialog button) is non-standard. Always round to `rounded` (8px) in code; do not preserve the 7.

## Spacing

Tailwind's default 4px-base scale. Allowed values: `0,1,2,3,4,5,6,8,10,12,16,20,24,32,40,48,56,64,80,96`. Figma values not on this scale (e.g. 18, 42, 45) snap to the nearest neighbor.

## Layout primitives

| Pattern | Spec |
|---|---|
| Hero mauve section | `bg-mauve-200 rounded-xl px-8 pt-[42px] pb-16 shadow-sm` |
| Inner content card | `bg-ink-0 rounded-lg p-6 shadow` |
| Accordion row | `bg-mauve-50 rounded-sm py-4 px-0 inset-divider` |

## Buttons (binding)

The product is anchored on **mauve quiet**: every button is either a mauve-filled CTA or a white-with-ink-border outline. There is no black-filled button anywhere in the product.

| Variant | Fill | Border | Text | Hover | Use |
|---|---|---|---|---|---|
| **primary** | `mauve-200` | — | `ink-900` | `mauve-100` | Default CTA — `Continue`, `Save`, `New project`, `Delete interview` (final confirm in Dialog) |
| **outline** | `ink-0` | `ink-900` 1px | `ink-900` | `mauve-50` bg | Secondary, paired with primary — `Cancel`, `Skip`, also used as the "View docs" CTA on mauve hero cards (where mauve-fill would disappear) |
| **ghost** | transparent | — | `ink-900` | `mauve-50` bg | Tertiary — toolbar actions |
| **link** | — | — | `ink-900` underline | text `ink-800` | Inline text actions |

Sizing: default `h-10 px-4 rounded text-body-sm`. Compact `h-8 px-3 text-caption`. Icon-only `h-10 w-10 rounded-full`.

### Critical button rules

- IMPORTANT: There are no black-filled buttons. Every CTA is mauve-filled or outline. This is the visual signature of the product.
- IMPORTANT: Default CTA is **primary (mauve fill, ink-900 text)**. Use `outline` when paired with primary as the secondary action, or as the only CTA on a mauve surface (where mauve-fill is invisible).
- IMPORTANT: Destructive actions stay monochrome. Color does not warn — copy and confirmation flow do. A `Delete interview` button looks identical to a `Save` button; safety is provided by the dialog title ("Are you absolutely sure?"), the body copy, and the irreversible-action confirmation.
- IMPORTANT: On a mauve hero card, the CTA must be `outline` (white fill + ink-900 border). `View docs` style: outline + `font-doc-link` + `underline`.
- IMPORTANT: When the button system changes, search every component (Dialog, Alert Dialog, Form, Sheet, Sidebar, Toolbar, Modal, Empty State, etc.) for button usages and update them all in the same pass. Never partially migrate.

## Sidebar (binding)

The product Sidebar follows the **Linear hover-expand** pattern, not the classic always-expanded or click-toggle pattern. There are exactly **three states**:

| State | Width | Layout impact | When |
|---|---|---|---|
| **Collapsed** (default) | `56px` | Inline, content is 1384px on a 1440px viewport | Idle. User has not interacted with the rail. |
| **Hover-Expanded** (overlay) | `264px` | Overlay — floats above content with `shadow-lg`. Content does not shift. | Mouse enters the rail. ~300ms leave delay. |
| **Pinned** (inline) | `264px` | Inline, content is 1176px | User clicked the pin icon in the brand row. |

### Critical sidebar rules

- IMPORTANT: Default is **Collapsed**, not Expanded. Always-expanded sidebars eat screen real estate; the product is workflow-heavy and content is the priority.
- IMPORTANT: Hover-expand is **overlay, not push**. A push (layout-shift) sidebar makes content jump every time the user moves the cursor — disqualifying for long reading surfaces (transcripts, reports). The overlay floats above content with `shadow-lg`.
- IMPORTANT: When pinned, the layout reflows once. Pinned state must persist across sessions (store in user preferences).
- IMPORTANT: Each collapsed icon must show a tooltip on hover with the full label (and count/badge if any). This is non-optional for accessibility.
- IMPORTANT: Mouse-leave delay before collapsing back is `~300ms` to prevent accidental collapse during cursor pathing.
- The pin button is in the brand row, replacing any other icon there. Active (pinned) state uses `bg-mauve-200`; inactive uses outline icon, no fill.
- Section labels ("MAIN", "ACCOUNT") are visible in expanded states; in collapsed they collapse to a thin `ink-200` divider.
- Counts and badges in collapsed state become a small `ink-900` dot with a 1.5px white ring at the icon's top-right (tells "there's something" without revealing what).
- IMPORTANT: The rail reads as **pure white** (`bg-ink-0`) with a hairline right edge (`inset -1px ink-100`). Row hover = `mauve-50` (warm white); row **active/selected** = `ink-100` surface + `ink-900` label + `ink-900` icon. Never use a mauve fill or any indigo/blue for nav/study active state — the signature mauve stays on content cards/buttons, not the rail. (This is the Mauve-Quiet translation of the Outset/Make pure-white reference; indigo `#4F46E5` / `#EEF2FF` accents are forbidden.)
- IMPORTANT: The account avatar carries **no invented brand color**. Its color comes from the real user avatar; with no user it is a neutral placeholder (`bg-ink-100` + `text-ink-600` initial). Do not hardcode a `mauve-400` (or any) avatar fill.

### Implementation note

In `apps/web`, the sidebar is a single component with three states driven by:

```ts
const [pinned, setPinned] = useLocalStorage('sidebar.pinned', false);
const [hovered, setHovered] = useState(false);
const expanded = pinned || hovered;
```

Layout: when `pinned`, sidebar is part of the main grid. When `hovered && !pinned`, sidebar is `position: fixed` over content with the same z-index as a popover. Use a transition delay of `300ms` on `mouseLeave`.

### Toggle / Switch states (binding)

Same monochrome principle as buttons — no black-fill in normal product UI.

| State | Track fill | Knob | Notes |
|---|---|---|---|
| **on** | `mauve-200` | `ink-0` with `border border-ink-900` (1px) | Knob ring restores definition since white-on-mauve has 1.4:1 contrast |
| **off** | `ink-200` | `ink-0` (no border) | Default low-contrast off state |
| **disabled** | `ink-100` | `ink-0` with `border border-ink-200` | Both halves muted |

Same rule applies to: Switch, Toggle, Toggle Group active state.

### Pre-token utility classes

| Pattern | Spec |
|---|---|
| Primary button | `bg-mauve-200 hover:bg-mauve-100 text-ink-900 rounded px-4 py-2 font-ui font-medium text-body-sm` |
| Outline button | `bg-ink-0 hover:bg-mauve-50 text-ink-900 border border-ink-900 rounded px-4 py-2 font-ui font-medium text-body-sm` |
| External doc button (on mauve hero) | `bg-ink-0 text-ink-900 border border-ink-900 rounded px-4 py-2 font-doc-link underline text-body-sm` |
| Switch on | `bg-mauve-200` track + `bg-ink-0 border border-ink-900` knob |
| Switch off | `bg-ink-200` track + `bg-ink-0` knob |

### Disclosure / row layout (binding)

For any list-like row that has a label on the left and a state indicator on the right (chevrons, expand/collapse arrows, "open in new tab" icons, kbd hints, count badges):

- IMPORTANT: The trailing icon/indicator **MUST sit flush against the right edge** of the row, never adjacent to the label.
- The row container uses horizontal auto-layout with the label set to `flex-1` (Figma `layoutGrow: 1`), and the head must `STRETCH` to the parent's full width.
- This applies to: Accordion, Collapsible, Select trigger, Dropdown trigger, Context Menu items with kbd, Combobox, Navigation Menu items, Sidebar nav rows, Table sort headers, List items with metadata.

#### Figma plugin implementation note

When building these rows in Figma via the plugin API, do not rely on `layoutGrow=1` on a TEXT node — it is unreliable. Use the modern sizing API explicitly:

```js
// On the head row (HORIZONTAL auto-layout):
head.layoutSizingHorizontal = 'FILL';   // fill parent's width
head.primaryAxisAlignItems  = 'SPACE_BETWEEN';
head.counterAxisAlignItems  = 'CENTER';

// Parent containers must be FIXED width upstream so FILL has a target:
row.layoutSizingHorizontal  = 'FILL';
card.layoutSizingHorizontal = 'FIXED';

// Label can be HUG; the SPACE_BETWEEN does the work:
label.layoutSizingHorizontal = 'HUG';
```

#### Critical ordering — call FILL after appendChild

`layoutSizingHorizontal = 'FILL'` requires the node to already be a child of an auto-layout parent. If you set FILL while the node is still detached, Figma silently ignores it. Always:

```js
parent.appendChild(node);          // first
node.layoutSizingHorizontal='FILL'; // then
```

Wrap calls in try/catch only when you genuinely expect failure (e.g. a node that may or may not have an auto-layout parent). Do NOT use try/catch as a blanket safety net — it will hide silent failures and you'll waste time debugging "why doesn't this fill" later. If FILL on a freshly-appended child doesn't work, the parent's `layoutMode` is wrong, not the FILL call.

In CSS / Tailwind, the equivalent is `flex items-center justify-between w-full`.

## Tailwind config snippet

When `apps/web` exists, paste this into `tailwind.config.ts` (`theme.extend`) — or the v4 `@theme` block in `styles.css`.

```ts
// theme.extend
colors: {
  mauve: {
    50:  '#F9F6F6',
    100: '#EAE3EC',
    200: '#D7CFD9',
    400: '#A78585',
  },
  ink: {
    0:   '#FFFFFF',
    100: '#F1F5F9',
    200: '#E2E8F0',
    400: '#64748B',
    600: '#475569',
    800: '#1E293B',
    900: '#0F172A',
  },
  // No status colors. Status is communicated via icon + copy + container position.
},
fontFamily: {
  display:   ['"Inclusive Sans"', 'ui-sans-serif', 'system-ui'],
  reading:   ['"Inclusive Sans"', 'ui-sans-serif', 'system-ui'],
  ui:        ['Inter', 'ui-sans-serif', 'system-ui'],
  data:      ['"Istok Web"', 'ui-monospace', 'monospace'],
  decor:     ['Inika', 'serif'],
  'doc-link':['"Inknut Antiqua"', 'serif'],
},
fontSize: {
  caption:       ['12px', { lineHeight: '16px', letterSpacing: '0.05px' }],
  'body-sm':     ['14px', { lineHeight: '24px' }],
  body:          ['16px', { lineHeight: '24px' }],
  'body-lg':     ['20px', { lineHeight: '28px' }],
  'display-md':  ['20px', { lineHeight: '28px' }],
  'display-lg':  ['24px', { lineHeight: '32px', letterSpacing: '-0.15px' }],
  'display-xl':  ['30px', { lineHeight: '36px', letterSpacing: '-0.225px' }],
},
boxShadow: {
  xs:       '0 1px 1px rgba(167,133,133,0.06)',
  sm:       '0 2px 4px rgba(167,133,133,0.08)',
  DEFAULT:  '0 4px 8px rgba(167,133,133,0.10)',
  md:       '0 8px 16px rgba(167,133,133,0.12)',
  lg:       '0 16px 32px rgba(167,133,133,0.14)',
  popover:  '0 4px 24px rgba(167,133,133,0.18)',
},
borderRadius: {
  xs: '4px', sm: '6px', DEFAULT: '8px', md: '12px', lg: '16px', xl: '20px',
},
```

Web fonts (loaded via `<link>` or `@import`):

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Inclusive+Sans:wght@400;600&family=Istok+Web&family=Inika&family=Inknut+Antiqua&display=swap" rel="stylesheet">
```

## Figma MCP Integration Rules

These rules apply to every Figma-driven implementation. Read together with `.kiro/specs/foundation-setup/design.md`.

### Required flow (do not skip)

1. Run `get_design_context` for the exact node(s) the user pointed to.
2. If output truncates or the node is large, run `get_metadata` first to map the subtree, then re-fetch only required children with `get_design_context`.
3. Run `get_screenshot` for visual reference. Save the screenshot URL in your scratch but do not commit it.
4. Run `get_variable_defs` to extract any locally-defined Figma variables.
5. Translate the Figma output (React + Tailwind) into project conventions per this file. The Figma output is a description, not final code.

### Translation rules (binding)

- IMPORTANT: Map every Figma color to a token in this file. If a Figma value has no token, **stop and update this file first** — do not inline the hex.
- IMPORTANT: Map every font family to a `font-*` semantic role above. Never write `font-['Inter']`.
- IMPORTANT: Snap Figma sizes/spacing to the scale. Preserve visual fidelity — if a Figma value cannot be expressed within ±1px, document the deviation in this file and add a token.
- Reuse components from `apps/web/src/components/ui/` (shadcn primitives) before authoring new ones.
- Use `apps/web` path alias `@/` (per `apps/web/components.json`) — never relative imports across feature boundaries.
- Never install a new icon package. All icon SVGs come from the Figma payload (Localhost / mcp.figma.com hosted URLs) or the existing `lucide-react` (already a shadcn convention).
- Never bring `Inknut Antiqua`, `Inika`, `Istok Web`, or `Inclusive Sans` into a context they are not assigned to in the typography table above.

### Asset rules

- IMPORTANT: When the Figma MCP server returns an asset URL (`https://www.figma.com/api/mcp/asset/...`), use it directly. The URL is short-lived; download to `apps/web/public/figma/<asset-name>` only when the asset must persist.
- Do not create placeholder gradients / colored boxes when an asset URL is provided.

### Validation

After implementation, compare the rendered output against the Figma screenshot side-by-side. If anything differs in layout or color beyond ±1px / ±2% lightness, fix before marking done.

## Component Coverage Inventory

This is the canonical list of components the design system MUST cover. Source = the shadcn community Figma file (file key `RPRXJrCYDM8GyEmzQl1PFd`) plus product-driven additions for MerismV2.

### From source (27)

Accordion, Alert Dialog, Aspect Ratio, Avatar, Button, Checkbox, Collapsible, Command, Context Menu, Dialog, Dropdown Menu, Hover Card, Input, Label, Menubar, Navigation Menu, Popover, Progress, Radio Group, Scroll Area, Select, Separator, Slider, Switch, Tabs, Textarea, Tooltip.

### Added for MerismV2 (15)

Card, Badge, Alert, Toast (Sonner), Sheet, Skeleton, Calendar, Date Picker, Form, Table, Data Table, Pagination, Breadcrumb, Toggle / Toggle Group, Combobox.

Total: **42 components**. Each must exist in the Figma design file's Components page with a description block matching the source layout (title + tagline + "View docs" button), and be re-implemented in code under `apps/web/src/components/ui/` once that app exists.

## Update Procedure

When the design language evolves:

1. Update tokens in this file first.
2. Update the Figma file's Primitives page (variables / styles).
3. Update `apps/web/tailwind.config.ts` to match.
4. Run a visual regression / Storybook sweep before merging.

Never let one of the three (steering / Figma / code) drift ahead of the other two by more than one PR.
