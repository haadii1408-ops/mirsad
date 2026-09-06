# MIRSAD FREE 1.1 Mobile Ready

## Release
Version: 1.1.0

## Main change
Automatic, idempotent startup initialization for Render Free deployments:
- database schema/migrations
- 49 government-school ETEC indicators
- indicator baseline metadata
- optional owner bootstrap from secret environment variables

## Deployment contract
Required:
- `DATABASE_URL`
- `JWT_SECRET` (32+ random characters; 64+ recommended)

Optional first-use owner bootstrap:
- `BOOTSTRAP_OWNER_EMAIL`
- `BOOTSTRAP_OWNER_PASSWORD` (12+ characters)
- `BOOTSTRAP_OWNER_NAME`

## No Shell required
The service initializes the database before starting the HTTP server. This is designed specifically to avoid requiring Render Shell or a paid compute plan for first-time setup.

## Security
Do not commit `.env` or real secrets to GitHub. Remove one-time bootstrap credentials from Render after the owner account is successfully created if desired.
