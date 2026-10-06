# Lomakeavustin

Smart form assistant. An MVP for filling in health-related pre-information forms with database-driven dynamic forms, drafts, prefill from the user's own earlier data, and a local AI that explains questions in plain language.

> MVP, not a production healthcare system. The project uses **synthetic data only**. Never enter real patient or health information.

## Goal

Build a simple, working MVP covering the core features: form template management, dynamic form filling with validation, drafts, prefill with consent, AI question explanations, and a summary before submission. A professional view shows customers' submitted forms.

## Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js, TypeScript, Tailwind CSS |
| Backend | Express, TypeScript |
| Database | MariaDB |
| AI (later) | Ollama, called only by the backend |
| Dev environment | Docker Compose |

## Architecture

```text
Browser -> Next.js (frontend) -> REST API (/api/*) -> Express (backend) -> MariaDB
                                                      Express -> Ollama (later)
```

The browser only talks to the frontend. Next.js proxies `/api/*` to the backend, so no CORS setup is needed.

## Project structure

```text
lomake_avustin/
├── frontend/          Next.js app (src/app)
├── backend/           Express API (src/)
├── database/init/     SQL run on first MariaDB start
├── scripts/           Helper scripts (e.g. synthetic test data)
├── docs/er/           ER diagram (draw.io + PNG)
├── docker-compose.yml
└── .env.example
```

## Running locally with Docker

Requirements: Docker with Compose v2.

```bash
cp .env.example .env
docker compose up -d --build
```

| Service | URL |
| --- | --- |
| Frontend | http://localhost:3000 |
| Backend | http://localhost:4000 |
| MariaDB | 127.0.0.1:3307 |

Ports are bound to localhost only and can be changed in `.env`. Source code is bind-mounted, so changes reload automatically.

Stop the stack with `docker compose down`. Adding `-v` also deletes the database volume and all its data.

## Health check

```bash
curl http://localhost:4000/api/health
# or through the frontend proxy
curl http://localhost:3000/api/health
```

Returns `200` with `{"status":"ok","database":"ok",...}` when the backend and database are reachable, and `503` with `"status":"degraded"` if MariaDB cannot be reached.

## Running without Docker

Each app has its own `.env.example`. Copy it to `.env`, then run `npm install` and `npm run dev` in `frontend/` or `backend/`.
