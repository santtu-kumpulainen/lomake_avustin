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

## Database

The schema lives in `database/init/001_schema.sql` and is applied automatically the first time MariaDB starts with an empty volume.

| Table | Purpose |
| --- | --- |
| `users` | Login identity and role (`USER`, `ADMIN`, `PROFESSIONAL`) |
| `user_profiles` | One-to-one profile data for a user |
| `form_templates` | Reusable form definitions (`DRAFT`, `PUBLISHED`, `ARCHIVED`) |
| `form_fields` | Ordered fields of a template (`TEXT`, `NUMBER`, `DATE`, `SELECT`) |
| `form_submissions` | A user's draft or submitted form with a reference code such as `LA-7F42K9` |
| `form_answers` | One answer per field per submission, with a prefilled flag |
| `customer_contacts` | Synthetic contact history for the professional view |

ER diagram: [`docs/er/lomakeavustin-er.png`](docs/er/lomakeavustin-er.png) (editable source: `docs/er/lomakeavustin-er.drawio`).

Schema changes are not applied to an existing volume. To re-initialize the local database, run `docker compose down -v` and `docker compose up -d`. This deletes all local database data.

## Running without Docker

Each app has its own `.env.example`. Copy it to `.env`, then run `npm install` and `npm run dev` in `frontend/` or `backend/`.
