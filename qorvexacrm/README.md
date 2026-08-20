# QORVEXA CRM — Landing Page

The public marketing page for [QORVEXA CRM](../README.md) — served at the site
root (`/`) by the CRM's Express server, while the CRM app itself lives at
`/app`. One URL, one Docker stack.

Built with React 19 + Vite 7 + Tailwind v4 (plain static build — no SSR), so
the output in `dist/` is a self-contained set of HTML/CSS/JS assets.

## Development

```sh
npm install
npm run dev        # vite dev server (default http://localhost:5173)
npm run build      # static build → dist/
npm run preview    # serve the built output locally
```

In local dev the demo form posts to the same origin. To point it at a CRM API
running elsewhere (e.g. the CRM dev server on :8787), set:

```sh
VITE_CRM_API=http://localhost:8787/api npm run dev
```

## How it ships (single stack)

The CRM `Dockerfile` builds this page (`cd qorvexacrm && npm ci && npm run
build`) and copies `dist/` into the image at `/app/landing`. The Express server
then serves:

| Path | Served from |
|---|---|
| `/` (landing page) | `landing/` (this build) |
| `/app` (CRM app) | the CRM SPA (`dist/`) |
| `/api/*` | the CRM API |

The demo form posts to `POST /api/public/forms/request-a-demo/submit` — the
CRM's public lead-capture endpoint (honeypot + per-IP rate limit + duplicate
detection). Submissions become routed leads with `source: "Website"` in the
CRM. The seeded demo `LeadForm` (`request-a-demo`) is created by `npm run
seed`; delete it in Settings → Lead capture to take the form offline.

## Content

All copy lives in `src/components/LandingPage.tsx` (hero, principles, the
16-phase grid, capabilities, differentiators, stack/quickstart) and
`src/components/DemoRequest.tsx` (the demo form). Metadata (title, description,
OG/Twitter tags) lives in `index.html`.
