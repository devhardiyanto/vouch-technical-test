# Vouch Builder Take-Home

Welcome — thanks for taking the time.

**Start here:** read [`BRIEF.md`](BRIEF.md). It describes the task, what to build,
and how to submit.

Your sample data is in [`data/`](data/):
- `events.json` — structured front-desk events
- `night-logs.md` — one night logged as free text

Timebox is ~2 hours. We're looking for sharp tradeoffs, not completeness. Good luck.

---

## Live demo

Deployed on Railway. The first handover call takes ~30–40s (two OpenAI calls); `/health` is instant.

```bash
# Action-first handover (HTML) — bundled sample data
curl -X POST "https://vouch-technical-test-production.up.railway.app/handover?hotel=lumen-sg&date=2026-05-30"

# Same, as JSON (sourceIds visible on every item)
curl -X POST "https://vouch-technical-test-production.up.railway.app/handover?hotel=lumen-sg&date=2026-05-30&format=json"

# Health
curl "https://vouch-technical-test-production.up.railway.app/health"
```

Design rationale and tradeoffs: [`DECISIONS.md`](DECISIONS.md). Architecture and dev commands: [`CLAUDE.md`](CLAUDE.md).
