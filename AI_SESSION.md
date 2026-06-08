# AI Session Export

One representative session of how I work with an AI agent (Claude Code) on this repo.
This one is a **pre-submission audit + live verification** session: check the build against
the brief, then prove the deployed service actually holds its grounding guarantees with a real
`curl` — concrete evidence over claims.

> Other sessions (planning, the ingestor/reconciler build, the prompt-injection decision) live in
> the commit history. This export is the one I'm proudest of because it's where I stopped trusting
> my own README and made the running service prove itself.

---

## 1. Me → Agent: audit against the brief, objectively

> "I want to know, objectively, whether what's in `source-code/handover-api/` — given its
> `CLAUDE.md` and `BRIEF.md` — is something I can report as done, in the context of the Vouch HR
> email. What do you think?"

**Agent (after reading BRIEF.md, CLAUDE.md, DECISIONS.md, README.md, git log, file tree):**

Verdict: engineering is strong on exactly what Vouch grades (grounding, reconciliation,
anti-injection, structured logging), but **2 of 5 deliverables are missing** and both are hard
requirements:

| # | Deliverable | Status |
|---|---|---|
| 1 | Repo + full commit history (no squash) | ✅ 9 conventional commits, staged per pipeline phase |
| 2 | **Deployed URL + curl** | ❌ DECISIONS.md still said `_to be filled after deploy_` |
| 3 | AGENTS.md / CLAUDE.md committed | ✅ `CLAUDE.md` tracked |
| 4 | DECISIONS.md (6 sub-points) | ✅ all six covered |
| 5 | **One AI conversation export** | ❌ absent |

Also flagged: the git remote points at a personal account
(`vouch-technical-test`) — must be public or Vouch invited, or the link is dead on their side.

This is the part I value most about working with an agent: it read the *actual* deliverable list
and cross-checked the repo state instead of agreeing with me. The two gaps were real.

---

## 2. Me → Agent: here's the live URL — fill the gaps, but prove it first

> "OK, the live Railway domain is https://vouch-technical-test-production.up.railway.app/ —
> complete what's missing and commit/push it. But test the domain first so we have concrete proof."

**Agent — health check first:**

```bash
curl -s "https://.../health"
# {"status":"ok","ts":"2026-06-08T10:30:37.694Z"}   [HTTP 200 | 0.59s]
```

**Then the real thing — the grounded handover as JSON, so `sourceIds` are visible:**

```bash
curl -s -X POST ".../handover?hotel=lumen-sg&date=2026-05-30&format=json"
# [HTTP 200 | 40.8s]   ← two OpenAI calls, as documented
```

What the live response proved, point by point against the invariants in DECISIONS.md:

- **Grounding** — every item carried `sourceIds` (e.g. Room 309 deposit →
  `["evt_0007","evt_0014","freetext_2026-05-27_05"]`). No bare claims.
- **Prompt-injection safety** — `evt_0026` surfaced under `flagged` as
  *"Suspicious Guest Message — Content withheld for security"*. The injection text never reached
  the prose. A second suspicious free-text event was caught the same way.
- **Reconcile, don't re-report** — carried issues kept their original open-date via
  `carryOverFrom` (e.g. Room 204 compliance `carryOverFrom: 2026-05-25→2026-05-26`, escalated to
  `actNow`), not re-emitted as new noise.
- **Action-first** — `actNow` held only the two genuinely urgent threads (compliance past window,
  deposit + imminent checkout); everything else fell to `pending` / `fyi`.
- **HTML path** — `GET ...&format=html` returned `200 text/html` with a styled, titled page.

That 40s vs 0.6s split is itself the documentation: the LLM is confined to the messy edges; the
fast deterministic path (health, routing) doesn't touch it.

**Then the agent completed the gaps:**
1. DECISIONS.md `## Deploy` — real Live URL + HTML/JSON/health curl samples + latency note.
2. README.md — a "Live demo" block with the three curls.
3. This `AI_SESSION.md`.
4. Committed and pushed.

---

## How I actually work, in three habits visible above

1. **Make the agent argue with the brief, not with me.** The objective audit caught two missing
   deliverables I'd have shipped without.
2. **Proof beats prose.** I didn't let "it's deployed" stand — I made the live endpoint emit its
   own grounding evidence (`sourceIds`, withheld injection, `carryOverFrom`) before writing it down.
3. **Keep trust-critical logic out of the model, and show it.** The latency gap between `/health`
   and `/handover` is the architecture admitting where the LLM is — and isn't.
