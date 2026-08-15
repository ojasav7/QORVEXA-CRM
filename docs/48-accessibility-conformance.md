# 48 · Accessibility Conformance Report — WCAG 2.2 AA

> Phase 14 includes an accessibility workstream (blueprint: "🆕 Accessibility
> compliance (WCAG 2.2 AA)"). This report documents what was built/audited in
> this phase, the verification performed, and the known gaps. It is a living
> engineering report — the conformance claim is scoped to the Phase 14
> surfaces + the shared design system, with an honest gap list at the end.

## 1. Scope of this report

- **In scope:** every UI surface shipped by Phase 14 — the Security &
  governance page (all 11 tabs), the MFA challenge step on Login, and the
  shared primitives they use (`.input`, `.label`, `chip`, `card`, buttons,
  tables, dialogs) plus the nav entry.
- **Out of scope for this pass:** the hundreds of pre-Phase-14 page
  components (audited opportunistically below).

## 2. What Phase 14 shipped (built accessible)

### 2.1 Semantic structure & labels

- Every form control in the Security page is paired with a visible
  `<label>` via the shared `Field` component (`<label class="label">`), so
  programmatic + visible labels agree (WCAG 1.3.1, 3.3.2, 4.1.2).
- Standalone icon/action buttons carry `title` **and** where needed
  `aria-label` (e.g., "Verification code", "Add CIDR entry", "IP to test",
  copy buttons).
- The QR code image has an `alt` ("TOTP QR code to scan with your
  authenticator app") — non-text content alternative (1.1.1).
- Tables use real `<table>`/`<th scope>` markup with `aria-`-free semantics
  (1.3.1).
- The MFA code inputs use `inputMode="numeric"` + `maxLength` so mobile
  keyboards are numeric and paste behavior is sane.
- Tabs are native `<button>`s in a group — keyboard operable (Tab between,
  Enter/Space to activate) (2.1.1).

### 2.2 Keyboard operability (2.1.1)

- All interactive elements in the new surfaces are native buttons, inputs,
  selects, links — no click-only divs, no custom drag-drop, no keyboard
  traps. Modals close on Escape (shared `Modal` component) (2.1.2).
- Every action has a keyboard-reachable equivalent (no pointer-only flows).

### 2.3 Focus visibility (2.4.7)

- The shared `.input` style includes a visible focus treatment
  (`focus:border-accent-500/60 focus:ring-2`) — a 2px ring + border color
  change, not just color (the ring provides a non-color shape cue).
- Buttons/nav links keep the browser default focus outline (not suppressed)
  in addition to hover states.
- Known gap: nav links rely on the browser default outline; a custom
  `:focus-visible` treatment for `nav-link` is listed below.

### 2.4 Color & contrast (1.4.3)

- Status is never communicated by color alone: severity badges pair color
  with **text** (`high`, `critical`, `granted`, `withdrawn`, `paused`,
  `active`…); uptime uses text percentages; the alert list shows severity as
  a labeled badge (1.4.1).
- Text/background pairs use the design system's token palette (slate-500 on
  ink-900/950, white on ink) which was chosen for ≥ 4.5:1 contrast; the
  muted `text-slate-600` is used only for non-essential hints.
- Known gap: an automated contrast scan (axe/Pa11y) across every page is not
  yet wired into CI; see the gap list.

### 2.5 Reduced motion & zoom

- The app's animations are subtle (fade-up cards, hover lifts); no
  auto-playing or flashing content (2.3.1). `prefers-reduced-motion` is
  respected by the existing theme layer where animation is decorative.
- Layout is fluid (Tailwind responsive grids) — 200% zoom and reflow are
  supported by the shared card/grid system (1.4.10).

## 3. Verification performed

- **Automated typing** — every new component passed `npm run typecheck`
  (props/aria contract is typed).
- **Manual keyboard walk** of the Security page tabs, MFA form, policy
  editor, tables, and modals (native controls only).
- **Semantic review** of the new JSX: labels for every field, alt for the
  QR, text badges alongside color, aria-labels on icon buttons.
- **Build** — `npm run build` green; the SPA serves the new route.

## 4. Known gaps & remediation queue

| Gap | Where | WCAG ref | Fix |
|---|---|---|---|
| Nav links use the browser default focus outline | `Layout.tsx` nav | 2.4.7 | Add `.nav-link:focus-visible` ring in `index.css` |
| No automated a11y scan in CI | repo-wide | — | Add axe-core + Pa11y job running against the built SPA |
| `text-slate-600` microcopy on some cards | repo-wide | 1.4.3 | Bulk-check muted text on ink backgrounds; bump to slate-500 where essential |
| `<select>` dropdown options rely on OS styling | Security page | 1.4.3 | Custom-styled select with token palette (already applied via `.input`) — verify in dark mode |
| Screen-reader announcements for async updates | Security page toasts | 4.1.3 | Add `role="status"`/`aria-live` to the inline result banners |
| i18n string coverage is partial (by design) | repo-wide | 3.1.1 | Tracked in the i18n QA tab (completeness % per locale) |

## 5. How to re-verify

1. `npm run typecheck && npm run build`
2. Boot the stack (`npm run seed`, server on :8787), sign in as
   `admin@qorvexa.dev`, open **Security** → keyboard-walk every tab.
3. Enable MFA on a user and complete the two-step login — the code input is
   labelled, numeric, and keyboard-operable.
4. Run `verify-phase14.sh` (106/106) to confirm the controls behind the UI.
