# Yard

Yard is a research-programme coordination app. It keeps people, projects, milestones, concept notes, publications, and events in one place so a programme stays legible between meetings.

This repo is a curated product repo. It intentionally excludes prototype artefacts, review notes, pitch decks, local uploads, and one-off experiments that are not part of the running app.

## What the app does

- Gives programme members a shared view of people, projects, milestones, publications, events, and early ideas
- Supports coordinator-led maintenance with lightweight contribution from researchers
- Provides a single app surface instead of scattered documents, email threads, and shared folders

The bundled seed data is still a fictional demo programme used for development and testing.

## Stack

- Frontend: React 19, Create React App with craco, Tailwind/shadcn-ui primitives
- Backend: FastAPI
- Storage: MongoDB when configured, JSON fallback for local development
- Packaging: Docker multi-stage build
- CI: GitHub Actions build check

## Quick start

### Docker

```bash
docker compose up --build
```

This runs the app on `http://localhost:8000` with JSON-backed local storage.

To run with local MongoDB:

```bash
docker compose --profile mongo up --build
```

### Local development

Yard local development is set up around:

- Frontend: `http://localhost:3001`
- Backend API: `http://localhost:8001`
- Python: `3.11+`

Backend:

```bash
cp backend/.env.example backend/.env
python3.11 -m pip install --user -r backend/requirements.txt
python3.11 -m uvicorn backend.server:app --reload --port 8001
```

Frontend:

```bash
cd frontend
cp .env.example .env.development.local
npm install
PORT=3001 npm start
```

The copied frontend env file points the app at `http://localhost:8001`, so the browser and API stay aligned during local work.

### Container hosts

For container deployments, the image listens on `PORT`, then `WEBSITES_PORT`, then falls back to `8000`.

Optional backend env vars can move JSON-backed demo data and uploads onto a persistent writable path:

```bash
YARD_DATA_DIR=/some/persistent/path
YARD_DATA_FILE=/some/persistent/path/data_store.json
YARD_UPLOADS_DIR=/some/persistent/path/uploads
```

This is useful for temporary demo deployments on container hosts where `/app` is not durable across restarts.

## Tests

```bash
pip install -r backend/requirements-dev.txt
pytest tests -q
```

## Project structure

```text
backend/                  FastAPI app, seed data, Python requirements
frontend/                 React app and UI code
tests/                    Backend test suite
.github/workflows/ci.yml  Docker build check
Dockerfile                Production-style container build
docker-compose.yml        Local app and optional Mongo profile
```

## Scope of this repo

Included here:

- App source code
- Minimal repo docs
- Local dev and CI/build infrastructure
- Seeded demo data required to run the app

Deliberately not included here:

- Review screenshots
- Pitch decks
- Design explorations
- Local upload artefacts
- Prototype scratch files
- Personal workflow/tooling state
