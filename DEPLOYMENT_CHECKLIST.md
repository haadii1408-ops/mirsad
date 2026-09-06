# MIRSAD FREE 1.1 — Deployment Checklist

- [ ] PostgreSQL service is Available.
- [ ] `DATABASE_URL` points to the database Internal URL.
- [ ] `JWT_SECRET` is random and at least 32 characters (64+ recommended).
- [ ] `BOOTSTRAP_OWNER_EMAIL` is set in Render.
- [ ] `BOOTSTRAP_OWNER_PASSWORD` is set in Render and is at least 12 characters.
- [ ] `BOOTSTRAP_OWNER_NAME` is set or left at its default.
- [ ] `AUTO_SEED_INDICATORS=true`.
- [ ] Deploy succeeds.
- [ ] Logs show `Database initialized. Indicators ready: 49.`.
- [ ] Logs show `Owner account ready:`.
- [ ] Logs show `MIRSAD listening on`.
- [ ] `/health` returns `ok: true`.
- [ ] Owner login works.
- [ ] Indicator browser shows 49 indicators.
- [ ] Create a test school from OWNER account.
- [ ] Verify school data isolation.
- [ ] Upload one evidence file and verify analysis.
- [ ] Remove one-time bootstrap email/password variables after successful owner creation if desired.
