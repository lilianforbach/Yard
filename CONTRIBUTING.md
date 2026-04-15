# Contributing to Yard

Keep changes small, intentional, and easy to verify.

## Working rules

- Do not push directly to `main`
- Use a feature branch for every change
- Commit in small checkpoints
- Test locally before opening a pull request

## Recommended flow

```bash
git switch -c feature/short-description
```

Make your changes, then:

```bash
git add <files>
git commit -m "Describe the change"
```

## Local verification

For a quick app check:

```bash
docker compose up --build
```

For backend tests:

```bash
pip install -r backend/requirements-dev.txt
pytest tests -q
```

For frontend iteration:

```bash
cd frontend
npm install
npm start
```

## Pull requests

Open a PR with:

- what changed
- why it changed
- how you tested it

Prefer squash merges to keep history readable.

## Seed data changes

If you change the demo content, update:

- `backend/seed_data.private.json`

If you want Yard to use a different private demo file at runtime, point `YARD_SEED_FILE` at it.

If you add new persisted fields, make sure the backend startup path still handles existing records safely.
