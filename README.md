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
| AI | Ollama (optional, local), called only by the backend |
| Dev environment | Docker Compose |

## Architecture

```text
Browser -> Next.js (frontend) -> REST API (/api/*) -> Express (backend) -> MariaDB
                                                      Express -> Ollama (optional)
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

The schema lives in `database/init/` (`001_schema.sql`, `002_sessions.sql`, `003_user_profile_birth_date.sql`, `004_form_template_category.sql`, `005_symptom_descriptions.sql`) and is applied automatically the first time MariaDB starts with an empty volume.

| Table | Purpose |
| --- | --- |
| `users` | Login identity and role (`USER`, `ADMIN`, `PROFESSIONAL`) |
| `user_profiles` | One-to-one customer profile: first and last name, date of birth, phone |
| `form_templates` | Reusable form definitions (`DRAFT`, `PUBLISHED`, `ARCHIVED`) with an optional category |
| `form_fields` | Ordered fields of a template (`TEXT`, `NUMBER`, `DATE`, `SELECT`) |
| `form_submissions` | A user's draft or submitted form with a reference code such as `LA-7F42K9` |
| `form_answers` | One answer per field per submission, with a prefilled flag |
| `symptom_descriptions` | A customer's own descriptions of why they seek help, newest first |
| `customer_contacts` | Synthetic contact history for the professional view |
| `sessions` | Login sessions (SHA-256 hash of the cookie token, expiry) |

ER diagram: [`docs/er/lomakeavustin-er.png`](docs/er/lomakeavustin-er.png) (editable source: `docs/er/lomakeavustin-er.drawio`).

Schema changes are not applied to an existing volume. To re-initialize the local database, run `docker compose down -v` and `docker compose up -d`. This deletes all local database data.

To add a new init file to an existing volume without deleting data, run it once manually, for example:

```bash
docker compose exec -T mariadb sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"' < database/init/002_sessions.sql
```

Existing volumes created before the customer profile need `003_user_profile_birth_date.sql` applied the same way (it only adds a nullable column). Volumes created before the demo form library need `004_form_template_category.sql` (adds the nullable `category` and `seed_key` columns), and volumes created before the symptom descriptions need `005_symptom_descriptions.sql` (adds one table).

## Authentication

Session-based authentication with an HTTP-only cookie.

| Endpoint | Description |
| --- | --- |
| `POST /api/auth/register` | `{ email, password }` -> `201 { user }`, creates a `USER` and logs in |
| `POST /api/auth/login` | `{ email, password }` -> `200 { user }` |
| `POST /api/auth/logout` | `204`, deletes the session and clears the cookie |
| `GET /api/auth/me` | `200 { user }` or `401` |

`user` is `{ id, email, role }`. The password hash is never returned.

Errors:

- `400 { error, fields }` with field codes: `email`: `required`, `invalid`; `password`: `required`, `too_short` (min 10), `too_long` (max 128)
- `409 { error, fields: { email: "taken" } }` on registration with an existing email
- `401 { error: "Invalid email or password" }` on login, the same for an unknown email and a wrong password
- `401` without a valid session, `403` for a wrong role

How it works:

- Passwords are hashed with argon2id.
- On login a random 256-bit token is set in the `la_session` cookie. Only its SHA-256 hash is stored in `sessions`, so logout invalidates the session on the server.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` from `SESSION_TTL_HOURS` (default 24). `Secure` is controlled by `COOKIE_SECURE` and must be `true` behind HTTPS; it is `false` for local `http://localhost`.
- The cookie is set on the frontend origin through the Next.js proxy, so no CORS or cross-site cookie setup is needed.

Backend middleware in `backend/src/auth/middleware.ts` protects later routes:

```ts
router.get("/something", requireAuth, handler);
router.post("/forms", requireRole("ADMIN"), handler);
router.get("/customers", requireRole("PROFESSIONAL", "ADMIN"), handler);
```

Both set `req.user` (`{ id, email, role }`). The role is read from the database on every request.

### Test accounts with other roles

Public registration always creates a `USER`; a submitted `role` is ignored. To get an `ADMIN` or `PROFESSIONAL` test account, register normally and change the role from the backend container:

```bash
docker compose exec backend npm run set-role -- admin@example.test ADMIN
docker compose exec backend npm run set-role -- ammattilainen@example.test PROFESSIONAL
```

This needs shell access to the backend, so the API has no role escalation path. Use synthetic `@example.test` addresses only.

### Tests

```bash
docker compose exec backend npm test
```

Integration tests run against the configured MariaDB, create `@example.test` users, test form templates, drafts and submissions, and delete them afterwards. Test files run one at a time (`--test-concurrency=1`): they share one database, and parallel files deadlocked each other's setup and cleanup.

After pulling dependency changes, rebuild the backend so its container `node_modules` volume is refreshed: `docker compose up -d --build -V backend`.

## Form templates

ADMIN users manage form templates at `/admin/forms` (linked from the home page for admins).

| Endpoint | Role | Description |
| --- | --- | --- |
| `GET /api/forms` | any signed-in | ADMIN gets all templates, other roles only `PUBLISHED` |
| `GET /api/forms/:id` | any signed-in | Template with fields ordered by position; unpublished is `404` for non-admins |
| `POST /api/forms` | ADMIN | `{ name, description? }`, creates a `DRAFT` |
| `PATCH /api/forms/:id` | ADMIN | Update name and description |
| `DELETE /api/forms/:id` | ADMIN | Delete a draft without submissions |
| `POST /api/forms/:id/publish` | ADMIN | Requires at least one field |
| `POST /api/forms/:id/unpublish` | ADMIN | Back to `DRAFT` |
| `POST /api/forms/:id/fields` | ADMIN | `{ label, description?, fieldType, required?, options? }`, appended last |
| `PATCH /api/forms/:id/fields/:fieldId` | ADMIN | Partial field update |
| `DELETE /api/forms/:id/fields/:fieldId` | ADMIN | Delete a field |
| `PUT /api/forms/:id/fields/order` | ADMIN | `{ fieldIds }`, must list every field of the template once |

Templates have an optional `category` (free text, max 100 characters, shown as "Aihe" on `/forms`). Field types are `TEXT`, `NUMBER`, `DATE` and `SELECT`. `SELECT` requires a non-empty list of unique `options`; other types must not have options. A template's structure can only be changed while it is a `DRAFT`, so published forms never change under a user filling them. Validation errors use the same `400 { error, fields }` format as authentication.

## Demo form library

Eight synthetic demo forms (Vastaanoton esitiedot, Oireiden, Kivun, Mielialan ja hyvinvoinnin, Unen ja palautumisen esitiedot, Lääkitystiedot, Allergiatiedot, Toimintakyvyn esitiedot) can be added as ordinary published templates:

```bash
docker compose exec backend npm run seed:demo-forms
```

They are self-made demonstration content, not official or clinically validated healthcare forms. The content is in `backend/src/seeds/demo-forms.ts` and is checked with the same validation as the admin API.

The seed is safe to run repeatedly. Each form has a fixed `seed_key`; a form whose key already exists is skipped and never changed, so admin edits (renaming, unpublishing, field changes) survive. It never deletes or resets anything and is not run on startup. A demo form an admin has deleted is created again on the next run. Requires `004_form_template_category.sql` on existing volumes.

## Filling in forms

Signed-in users pick a published form at `/forms` (sorted by name, with topic, description and a topic filter) and fill it in at `/forms/[id]`. Fields are rendered from the template returned by the API.

| Endpoint | Description |
| --- | --- |
| `POST /api/submissions` | `{ formTemplateId, answers: { [fieldId]: string } }` -> `201 { submission }` with `status: "SUBMITTED"`, `submittedAt` and a `referenceCode` such as `LA-7F42K9` |
| `POST /api/submissions/draft` | `{ formTemplateId, answers? }` creates a draft, `{ id, answers? }` updates the user's own draft |
| `GET /api/submissions` | The signed-in user's own submitted forms, newest first; query parameters are rejected |
| `GET /api/submissions/drafts` | The signed-in user's drafts |
| `GET /api/submissions/previous-data/available?formTemplateId=` | Whether the user's own earlier submission can prefill this form (`{ available, fieldCount }`, no values) |
| `GET /api/submissions/previous-data?formTemplateId=` | The values from the user's latest own submitted form of this template, requested only after consent |
| `GET /api/submissions/:id` | The signed-in user's own draft or submission with its answers (with field type; a submitted form also lists questions left empty); `404` for anyone else |
| `POST /api/submissions/:id/submit` | `{ answers? }`, validates the whole draft and submits it |

The backend validates every answer against the stored field definitions: required fields, numbers (a decimal comma is accepted and stored as a dot), real `YYYY-MM-DD` dates, and SELECT values from the options. Ids that are not fields of the form are rejected. Errors are `400 { error, fields: { [fieldId]: code } }`, and nothing is saved unless the whole submission is valid. Unpublished forms return `404`, also for admins.

Drafts: "Tallenna luonnos" saves an incomplete form, and the forms page lists the user's drafts to continue. Draft answers are merged (sent fields are saved, empty values clear an answer, others stay) and type-checked, but required fields may stay empty. Submitting a draft runs the full validation; on any error nothing changes and it stays a draft. A draft's reference code is shown only after it is submitted. If its form is unpublished, the draft is kept but cannot be changed or submitted until the form is published again.

Summary: "Jatka yhteenvetoon" runs the client checks and shows every answer in form order ("Ei annettu" for empty optional fields) without sending anything. The user can go back to edit, and "Lähetä lomake" works only after the confirmation checkbox is ticked. The final submit uses the same endpoints above, so backend validation and ownership checks still decide; a server-side error returns the user to the form.

Prefill: on a new form with earlier own data, the user chooses "Käytä aiempia tietojani" or "Täytä tyhjänä". Values are fetched only after consent, matched by field id within the same template, fill only empty fields, are marked "Esitäytetty aiemmista tiedoista" and stay editable. Only the user's own submitted forms are used (never drafts), any `userId` parameter is rejected, and submitting creates a new submission without changing the earlier one.

## Submitted forms

"Omat lähetykset" (`/submissions`) lists a customer's submitted forms with the form name, submission time, status and reference code. Opening one (`/submissions/[id]`) shows every question of the form in order with the submitted answer (dates and decimals in Finnish format, "Ei annettu" for questions left empty). Submitted forms are read-only. Only the user's own `SUBMITTED` forms are listed; another user's id gives `404`, also for `ADMIN` and `PROFESSIONAL`.

## Customer profile

Signed-in customers (`USER`) see and edit their own basic information on "Omat tiedot" (`/profile`).

| Endpoint | Description |
| --- | --- |
| `GET /api/profile` | `{ profile: { email, firstName, lastName, dateOfBirth, phone, updatedAt } }`; empty values until the first save |
| `PUT /api/profile` | `{ firstName, lastName, dateOfBirth, phone }` replaces the user's own profile |

The owner always comes from the session; the routes take no user id, and any other request key (`userId`, `email`, `role`...) is rejected with `400`. `ADMIN` and `PROFESSIONAL` get `403`. Email is the login identity from `users` and is read-only here. First and last name are required; date of birth (a real date from 1900 to today) and phone (digits with optional `+`, spaces, dashes, parentheses; 5-15 digits) are optional.

## Reason for seeking help

Customers (`USER`) describe in their own words why they are seeking help on "Miksi haet apua?" (`/symptoms`, linked from the home page) and see their own earlier descriptions, newest first.

| Endpoint | Description |
| --- | --- |
| `GET /api/symptom-descriptions` | `{ symptomDescriptions: [{ id, description, createdAt }] }`, the user's own, newest first |
| `POST /api/symptom-descriptions` | `{ description }` -> `201 { symptomDescription }` |

The description is 5-2000 characters after trimming; line breaks are kept and other control characters are rejected. The content is never interpreted: no diagnosis, urgency or classification. Descriptions are stored in their own table, separate from form submissions, and cannot be edited or deleted yet.

The owner always comes from the session. Any other body key (`userId`, `user_id`...) and any query parameter are rejected with `400`. `ADMIN` and `PROFESSIONAL` get `403`; professional access will be a separate, controlled feature. Descriptions are not sent to Ollama, not included in other API responses and not logged. The database pool sets `logParam: false`, so driver error messages (which the error handler logs) never contain query values such as answers or descriptions. A later AI feature may use the descriptions to suggest one of the published forms.

## AI question explanations

Each form question has a "Selitä kysymys" button. The backend asks a local Ollama model to explain the question in plain Finnish, and the result is shown under the question marked "AI-avustus". The answer field is never changed.

| Endpoint | Description |
| --- | --- |
| `POST /api/ai/explain` | `{ question, description?, fieldType, options? }` -> `200 { explanation }`; `400` validation, `401`, `503 { error: "AI unavailable" }` |

Configuration in `.env` (all optional; empty disables AI and forms work as before):

```bash
OLLAMA_BASE_URL=http://host.docker.internal:11434   # Ollama on the host; it must listen beyond 127.0.0.1 (OLLAMA_HOST=0.0.0.0)
OLLAMA_MODEL=gemma3:4b                              # the model tested for the MVP; any pulled model works
OLLAMA_TIMEOUT_MS=30000
```

Recreate the backend after changing these: `docker compose up -d backend`.

Privacy boundary: only the question text, its help text, the field type and SELECT options are sent to Ollama. Never answers, drafts, earlier submissions, user ids, emails or reference codes; any other request key is rejected with `400`. The prompt forbids diagnosis, treatment advice, invented information and answering for the user. Any Ollama failure (not configured, offline, timeout, error, invalid output) returns a generic `503` and the form stays fully usable. Explanations are not stored. Tests mock Ollama, so no running model is needed.

Tested end to end with `gemma3:4b` (about 1.5 s per explanation on a 6 GB GPU). Known limitations: date questions may get relative examples such as "viime viikolla" instead of a calendar date, unclear questions tend to be interpreted rather than flagged as unclear, and some Finnish phrasing is awkward. The output is always labelled as AI-generated.

## Running without Docker

Each app has its own `.env.example`. Copy it to `.env`, then run `npm install` and `npm run dev` in `frontend/` or `backend/`.
