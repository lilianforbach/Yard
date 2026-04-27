# Yard

Yard is a shared context app for research programmes. Keep projects, emerging ideas, publications, and events in one place, so programmes stay connected between meetings. Researchers can share updates, milestones, challenges, and early ideas, and Yard turns those signals into a shared picture of where things stand.

That makes it easier for programme members to give feedback, follow up, connect across projects, and offer support.

## Stack

- Frontend: React 19, Create React App with craco, Tailwind/shadcn-ui primitives
- Backend: FastAPI, Python 3.11+
- Storage: MongoDB when configured, JSON fallback otherwise
- Packaging: Docker multi-stage build
- CI: GitHub Actions backend tests and Docker build check

## Quick Start

### Docker

```bash
docker compose up --build
```

Runs the app on `http://localhost:8000` with JSON-backed local storage.

For local MongoDB:

```bash
docker compose --profile mongo up --build
```

### Local Development

Backend:

```bash
cp backend/.env.example backend/.env
python3.11 -m pip install -r backend/requirements.txt
python3.11 -m uvicorn backend.server:app --reload --port 8001
```

Frontend:

```bash
cd frontend
cp .env.example .env.development.local
npm install
PORT=3001 npm start
```

The local frontend runs on `http://localhost:3001` and points to the backend API on `http://localhost:8001`.

## Deployment Notes

The image listens on `PORT`, then `WEBSITES_PORT`, then falls back to `8000`.

For shared deployments, use MongoDB via:

```bash
MONGO_URL=<mongo-connection-string>
DB_NAME=<database-name>
```

For JSON-backed deployments on container hosts, set persistent paths so data and uploaded files survive a redeploy:

```bash
YARD_DATA_DIR=/some/persistent/path
YARD_DATA_FILE=/some/persistent/path/data_store.json
YARD_UPLOADS_DIR=/some/persistent/path/uploads
```

For any non-local deployment, set `JWT_SECRET` to a long random value and replace the default `ADMIN_PASSWORD`. See `backend/.env.example` for the full list of environment variables.

## Tests

Backend tests:

```bash
python3.11 -m pip install -r backend/requirements-dev.txt
YARD_UPLOADS_DIR=/tmp/yard_pytest_uploads python3.11 -m pytest tests/test_backend.py -q
```

Frontend build:

```bash
cd frontend
npm run build
```

Docker build check:

```bash
docker build -t yard:local .
```

## Project Structure

```text
backend/                  FastAPI app, Python requirements
frontend/                 React app and UI code
tests/                    Backend test suite
.github/workflows/ci.yml  Backend tests and Docker build check
Dockerfile                Container build
docker-compose.yml        Local app and optional Mongo profile
```

## Repo Scope

This repo contains the running app, its tests, and the build infrastructure. Local uploads, design explorations, and any private demo seed file are kept outside the repo and excluded from the Docker build context.

Yard runs without a seed file. If `YARD_SEED_FILE` points at a private JSON file at startup, those records bootstrap on first run only.

For branching, seed-data conventions, and pull-request flow, see [CONTRIBUTING.md](CONTRIBUTING.md).
