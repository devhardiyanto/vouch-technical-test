# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Backend service `handover-api`. Design rationale and tradeoffs are in [`DECISIONS.md`](DECISIONS.md).

## Commands

```bash
npm run dev        # tsx watch — hot-reload dev server on :3000
npm run typecheck  # tsc --noEmit — strict type check, run before committing
npm run build      # tsc → dist/
npm start          # node dist/index.js (prod; what Railway runs)

# Reconciler test (no test runner — a standalone tsx script with assertions):
npx tsx src/services/reconciler.test.ts
```

There is no Jest/Vitest. The single test file runs directly via `tsx` and `process.exit(1)`s on failure. It does **not** call OpenAI — it parses `data/events.json` plus hand-written synthetic free-text events, then asserts the expected reconciler classifications (the cross-night truth table).

Local run needs `OPENAI_API_KEY` in `.env` (loaded via `process.loadEnvFile` in `src/index.ts`; absent on Railway, which injects env directly).

### Exercising the endpoint

```bash
# Sample fallback (zero-setup demo): bundled data/events.json + night-logs.md
curl -X POST "http://localhost:3000/handover?hotel=lumen-sg&date=2026-05-30"
curl "http://localhost:3000/handover?format=json"   # GET also works; JSON instead of HTML

# Caller-supplied data (stateless path):
curl -X POST "http://localhost:3000/handover" -H 'content-type: application/json' \
  -d '{"hotel":"x","date":"2026-05-30","events":[...],"logs":"..."}'
```

## Architecture

A **stateless** Hono service: each request carries its own data (or falls back to bundled samples). No DB, no auth, no persistence — scale by adding replicas. One request → one structured JSON log line.

Pipeline (`src/handlers/handover.ts` orchestrates):

```
handler → ingestor → reconciler → generator → HTML | JSON
```

- **ingestor** (`services/ingestor.ts`) — normalizes both inputs into `NormalizedEvent[]`. JSON events parsed deterministically; the free-text night log is normalized by **OpenAI** (temp 0, JSON mode). Assigns each event to a **shift** (`deriveShift`: 23:00→07:00 spans two dates) and runs **injection detection** (`detectInjection`) on *every* event regardless of source. The free-text log omits the year, so `deriveReferenceYear` takes the mode year from JSON timestamps and `correctEventYear` fixes model drift.
- **reconciler** (`services/reconciler.ts`) — **pure deterministic code, no OpenAI.** Threads events by `room+type` across shifts and classifies each thread vs the target morning: `stillOpen` / `newlyResolved` / `newTonight`. Data-driven escalation to `severity: 'urgent'` (unresolved deposit + imminent checkout; compliance past its 48h window; safety risks — trapped guest valuables / physical hazards, high-precision patterns that exclude medical keywords to avoid over-firing). Suspicious events are pulled into `flagged[]` and excluded from content; contradictory / `needs_verification` events appear in *both* their bucket and `flagged[]`.
- **generator** (`services/generator.ts`) — OpenAI (temp 0, JSON mode) writes the prose, then `renderHtml` (pure) produces the page. The model sees **only reconciler output** — `buildPromptIssue` forwards structural metadata, never raw descriptions; suspicious event content is withheld entirely. Output validated with zod; **items with empty `sourceIds` are dropped**. HTML rendering is deterministic with `escapeHtml` on all external strings.

Two OpenAI calls per request (free-text extract + prose) → ~30s latency. `MODEL` is pinned in `src/lib/openai.ts` (lazy singleton, throws at call time not import).

### Non-negotiable invariants (these are what the test grades)

1. **Grounding** — every `HandoverItem.sourceIds` is mandatory and must trace to real event IDs. Unsourced items are discarded, never shipped.
2. **Prompt-injection safety** — detection runs at ingest before data reaches any generator prompt. The known injection (`evt_0026`) arrives via *structured* `events.json`, not free-text — "structured" ≠ "trusted". Flagged `suspicious`, withheld from content, shown as withheld under FLAGGED.
3. **Reconcile, don't re-report** — track issues across shifts; a carried issue keeps its original open-date, it does not re-appear as new noise.
4. **Contradictions surface, never resolve** — Room 205 (system says in-house, log says empty) goes to FLAGGED as `needs_verification`, not silently smoothed.
5. **Trust-critical logic is deterministic code, not the model** — JSON parsing, shift logic, classification, escalation, and HTML rendering never depend on the LLM. The model is confined to the messy edges (free-text normalization, prose).

### Request/data shapes

`src/types/index.ts` is the single source of truth: `RawEvent` → `NormalizedEvent` (adds `shift`, `source`, `flags`) → `ReconciledIssue` / `ReconcilerResult` → `HandoverItem` / `HandoverOutput`. The handler accepts a body of `{ hotel?, date?, events?, logs? }` where `events` is either a full `EventsFile` or a bare `RawEvent[]`; missing body falls back to `data/`. Shift labels are `"YYYY-MM-DD→YYYY-MM-DD"` (second date = the morning the shift ends / the report target).
