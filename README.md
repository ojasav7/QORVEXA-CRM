
# QORVEXA CRM

A production-oriented CRM and operating system for sales, service, marketing, analytics, and AI-assisted workflows.

QORVEXA is designed as a modular business platform built around a shared object-relationship-event model, high-visibility dashboards, workflow automation, and AI-powered insight generation. It is structured to scale from a lean CRM MVP into a broader enterprise operating system without redesigning the core architecture.

## Why this project

- Unified customer and account management
- Sales pipeline, activity tracking, and deal intelligence
- Customer service and ticket workflows
- Marketing automation and campaign orchestration
- Analytics, forecasting, and executive dashboards
- AI assistant layer with guards, memory, and business-context reasoning
- Multi-tenant-ready foundations for deployment and operations

## Stack

- Frontend: React + Vite + TypeScript
- Backend: Express + TypeScript
- Data layer: MongoDB + Prisma
- Authentication: session-based auth + OAuth-ready flows
- Deployment: Docker Compose and cloud-ready service configuration

## One URL, one stack

The public **landing page** (`qorvexacrm/` — a static Vite app) and the **CRM app**
(the React SPA) ship as a single Express server and a single Docker image:

- `https://your-domain/` → the marketing landing page
- `https://your-domain/app` → the CRM app (log in with the seeded demo user)
- `https://your-domain/api/*` → the REST API

The landing page's **Request a demo** form POSTs to the CRM's public lead-capture
endpoint, so every submission becomes a real lead (round-robin routed, source
"Website"). See [qorvexacrm/README.md](qorvexacrm/README.md) for the landing
page's build and content details.

## Architecture at a glance

```text
Browser
  ↓
React app
  ↓
Express API
  ↓
Prisma / MongoDB
  ↓
Business logic modules
  ├─ CRM objects and relationships
  ├─ Workflows and automation
  ├─ Analytics and forecasting
  ├─ AI and graph intelligence
  └─ Memory and event-driven workflows
```

## Repository structure

```text
.
├── src/                  # React frontend (the CRM app — served at /app)
├── server/               # REST API and business logic
├── qorvexacrm/           # Static landing page (served at /)
├── prisma/               # Prisma schema and generated client
├── docs/                 # Specs, setup docs, build reports
├── scripts/              # Build and utility scripts
├── backups/              # Generated snapshot archives
├── public/               # Static assets
├── dist/                 # Built CRM app (gitignored)
├── landing/              # Built landing page (gitignored)
├── Dockerfile            # Container image
├── docker-compose.prod.yml
├── package.json          # Scripts and dependencies
├── .env.example          # Environment template
├── README.md             # Project overview and setup guide
├── PROGRESS.md           # Build status and milestone notes
└── verify-phase*.sh      # Regression and verification scripts
```

## Quick start

### Prerequisites

- Node.js 20+
- npm
- Docker Desktop (for local MongoDB)

### One-command setup

```bash
git clone https://github.com/your-username/qorvexa-crm.git
cd qorvexa-crm
bash setup.sh
```

This handles everything: installs deps, starts MongoDB, generates Prisma client, pushes schema, and seeds demo data.

### Login credentials

- **URL:** http://localhost:8787/app
- **Email:** admin@qorvexa.dev
- **Password:** password123

### Manual setup (if you prefer)

```bash
npm install
npm run mongo:up
cp .env.example .env
npm run db:generate
npm run db:push
npm run seed
npm run dev
```

### What starts

- **API + CRM app:** http://localhost:8787/app
- **Landing page:** http://localhost:8787 (when built)

### Docker (production)

```bash
cp .env.example .env
# Edit .env: set SESSION_SECRET to a random string
openssl rand -hex 32  # generates one
docker compose -f docker-compose.prod.yml up -d --build
curl http://localhost:8787/api/health
```

## Environment variables

Copy the included template and configure your local or deployment values:

```bash
cp .env.example .env
```

Key values include:

- `DATABASE_URL`
- `SESSION_SECRET`
- `PUBLIC_BASE_URL`
- `ALLOWED_REGISTRATION_DOMAINS`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- `EMAIL_MOCK`
- `NODE_ENV`

For full details, see the setup and deployment docs in the `docs/` directory.

## Production build and deployment

### Docker Compose (recommended)

```bash
cp .env.example .env
openssl rand -hex 32
# set SESSION_SECRET and production values in .env

docker compose -f docker-compose.prod.yml up -d --build
```

Then verify:

```bash
curl http://localhost:8787/api/health
```

This stack includes the application container, MongoDB, and persistent volumes for backups and exports.

### Render / cloud deployment

This project is also designed for cloud deployment using a hosted MongoDB (for example Atlas) plus a web service environment. Production deployment settings should include:

- `DATABASE_URL`
- `SESSION_SECRET`
- `PUBLIC_BASE_URL`
- `PORT=8787`
- `NODE_ENV=production`

Use the repo docs for the exact recommended deployment flow and environment checklist.

## Build and verification

```bash
npm run build
npm run typecheck
```

`npm run build` typechecks the CRM, builds the CRM SPA into `dist/`, then builds
the landing page into `landing/` — both are served by Express in production.

For the landing page alone: `cd qorvexacrm && npm install && npm run dev`.

The repository also includes verification scripts for phase-by-phase regression validation and deployment health checks.

## Core documentation

- [docs/07-setup.md](docs/07-setup.md) — local setup, deployment, and troubleshooting
- [docs/08-decision-log.md](docs/08-decision-log.md) — architecture decisions
- [PROGRESS.md](PROGRESS.md) — milestone tracking and implementation status
- [QORVEXAThe intelligent operating system for business.md](QORVEXAThe%20intelligent%20operating%20system%20for%20business.md) — product blueprint and phased roadmap

## Project status

This codebase contains a full multi-phase platform implementation, including CRM core functionality, workflow automation, analytics, customer service, marketing automation, and AI business-intelligence layers.

## Notes

- `npm run seed` is useful for demo data in local development.
- Production snapshots and portability exports are written to gitignored runtime folders.
- Keep `SESSION_SECRET` secure in all non-local environments.

---

Built for real-world business operations, deployment workflows, and extensible product growth.
