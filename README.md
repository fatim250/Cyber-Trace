# CyberTrace

CyberTrace is a defensive digital forensics and cyber investigation platform.
The frontend includes an investigation dashboard. The dashboard uses clearly
labeled demonstration records unless an API base URL is configured.

## Project layout

- `backend/app/api`: FastAPI routing and versioned API entry points.
- `backend/app/core`: application configuration and shared infrastructure.
- `backend/app/db`: SQLAlchemy base and database session utilities.
- `backend/migrations`: Alembic schema migrations.
- `backend/app/models`: database model package.
- `backend/app/schemas`: Pydantic schema package.
- `backend/app/services`: business logic package.
- `backend/tests`: backend tests.
- `frontend/src`: React application, shared styles, and components.
- `frontend/src/data/demoDashboard.js`: isolated illustrative dashboard data.
- `frontend/src/services/dashboardApi.js`: API loading and response validation.
- `frontend/src/components/CaseManagement.jsx`: case list, details, and forms.
- `frontend/src/services/casesApi.js`: live Case API requests; no demo fallback.

## Development setup

1. Copy `.env.example` to `backend/.env` and set `DATABASE_URL` to a
   development MySQL database. Do not commit credentials.
2. Install and start the backend:

   ```powershell
   cd backend
   python -m pip install -e ".[dev]"
   python -m alembic upgrade head
   python -m uvicorn app.main:app --reload
   ```

3. In another terminal, install and start the frontend:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

In addition to FastAPI's built-in documentation endpoints, the backend now
exposes the Cases API. Database access is lazy: the API can start without a
configured database, but case requests return an explicit service-unavailable
error until `DATABASE_URL` is configured and the migration has been applied.

## Case management

The Cases page uses live API data only; it never falls back to dashboard demo
records. The development Vite server proxies `/api` to `http://127.0.0.1:8000`.
For a deployed frontend, route `/api` to the backend on the same origin.

Available endpoints:

- `GET /health` — backend liveness.
- `GET /health/ready` — checks database readiness.
- `POST /api/v1/cases` — create a case.
- `GET /api/v1/cases` — list cases, with optional `q`, `status`, `skip`, and
  `limit` query parameters.
- `GET /api/v1/cases/{case_number}` — read case details.
- `PATCH /api/v1/cases/{case_number}` — edit case information and/or status.

Case numbers are generated from the database ID (for example, `CT-000001`).
The assigned investigator field is currently a persisted name, not a link to
an authenticated user account; this project does not yet include investigator
identity or authentication. Do not expose this development API to untrusted
networks until authentication and authorization are implemented.

To verify a running backend, check `http://127.0.0.1:8000/health`, then
`http://127.0.0.1:8000/health/ready`; the second endpoint requires a configured
and reachable database. To run the backend tests, use `python -m pytest` from `backend`. The API tests
use an isolated in-memory SQLite database; actual MySQL connectivity requires
a configured and reachable MySQL server.

## Dashboard data source

Without `VITE_CYBERTRACE_API_URL`, the dashboard explicitly uses demonstration
data. The backend does not yet provide `GET /api/v1/dashboard/overview`; setting
this variable before that endpoint exists will make the dashboard show a
visible API error instead of its demo records. The Cases module independently
uses the case endpoints above through the `/api` proxy.

The endpoint should return `metrics`, `cases`, `evidenceIntegrity`,
`activityEvents`, and `analytics` fields. Evidence verification records are
expected to include one current check per evidence item, with an
`evidenceItemId`, `comparisonPerformed`, `algorithm`, and `sha256Matches`
field. A result is counted as a verified SHA-256 match only when the check
reports `comparisonPerformed: true`, `algorithm: "SHA-256"`, and
`sha256Matches: true`. No such endpoint currently exists in the backend, so the
dashboard remains in demonstration mode unless one is implemented and
explicitly configured.
