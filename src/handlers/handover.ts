import type { Context } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { ingest } from '../services/ingestor.js';
import { reconcile } from '../services/reconciler.js';
import { generateHandover, generateSections } from '../services/generator.js';
import { RequestLogger } from '../lib/logger.js';
import type { EventsFile, HotelMeta } from '../types/index.js';

// Resolve data/ directory relative to this module's location (src/handlers/ → data/)
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

// Last shift date present in the sample events.json
const SAMPLE_DEFAULT_DATE = '2026-05-30';

// ── Request body schema ───────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const HandoverRequestBodySchema = z.object({
  hotel: z.string().optional(),
  date: z.string().regex(DATE_REGEX, 'date must be in YYYY-MM-DD format').optional(),
  events: z.unknown().optional(),
  logs: z.string().optional(),
});

type HandoverRequestBody = z.infer<typeof HandoverRequestBodySchema>;

// ── Normalise body events into EventsFile ─────────────────────────────────────
// Accepts a full EventsFile { hotel, events } or a bare RawEvent array.

function bodyEventsToFile(
  rawEvents: unknown,
  hotelId: string
): EventsFile | null {
  if (!rawEvents) return null;

  // Full EventsFile shape
  if (
    typeof rawEvents === 'object' &&
    rawEvents !== null &&
    'events' in rawEvents &&
    Array.isArray((rawEvents as Record<string, unknown>)['events'])
  ) {
    return rawEvents as EventsFile;
  }

  // Bare array
  if (Array.isArray(rawEvents)) {
    const hotelMeta: HotelMeta = {
      id: hotelId,
      name: hotelId,
      rooms: 0,
      timezone: '+08:00',
    };
    return { hotel: hotelMeta, note: 'Provided via request body', events: rawEvents };
  }

  return null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handleHandover(c: Context): Promise<Response> {
  const format = c.req.query('format') ?? 'html';

  // 1. Parse query params (may be overridden by body)
  const queryHotel = c.req.query('hotel') ?? 'lumen-sg';
  const queryDate = c.req.query('date') ?? '';

  // 2. Parse request body (optional — all fields optional)
  let body: HandoverRequestBody = {};
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      rawBody = {};
    }
    const bodyParse = HandoverRequestBodySchema.safeParse(rawBody);
    if (!bodyParse.success) {
      const messages = bodyParse.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request body: ${messages}` }, 400);
    }
    body = bodyParse.data;
  }

  const hotelId = body.hotel ?? queryHotel;
  const usingBodyEvents = body.events !== undefined;

  // Body events: default to today; sample fallback: use last shift date
  const defaultDate = usingBodyEvents
    ? new Date().toISOString().slice(0, 10)
    : SAMPLE_DEFAULT_DATE;
  const targetDate = body.date ?? (queryDate || defaultDate);

  // 3. Hotel meta resolved after the data path below.

  // night refined to shift label after reconcile; targetDate is the best-effort error-path value.
  const logger = new RequestLogger(hotelId, targetDate);

  try {
    // 4. Resolve input data
    let eventsFile: EventsFile;
    let logsMarkdown: string;

    if (usingBodyEvents) {
      const parsed = bodyEventsToFile(body.events, hotelId);
      if (!parsed) {
        return c.json({ error: 'body.events must be a RawEvent array or EventsFile object.' }, 400);
      }
      eventsFile = parsed;
      logsMarkdown = body.logs ?? '';
    } else {
      logger.setStage('handler');
      const [eventsRaw, logsRaw] = await Promise.all([
        readFile(join(DATA_DIR, 'events.json'), 'utf-8'),
        readFile(join(DATA_DIR, 'night-logs.md'), 'utf-8'),
      ]);
      eventsFile = JSON.parse(eventsRaw) as EventsFile;
      logsMarkdown = body.logs ?? logsRaw;
    }

    const hotelMeta: HotelMeta = (eventsFile.hotel && eventsFile.hotel.id)
      ? eventsFile.hotel
      : { id: hotelId, name: hotelId, rooms: 0, timezone: '+08:00' };

    // 5. Ingest
    logger.setStage('ingestor');
    const events = await ingest(eventsFile, logsMarkdown, hotelMeta.id);

    logger.setEventsIngested(events.length);
    const flaggedIds = events
      .filter((e) => e.flags.includes('suspicious'))
      .map((e) => e.id);
    for (const id of flaggedIds) logger.addFlagged(id);

    // 6. Reconcile
    logger.setStage('reconciler');
    const reconcilerRaw = reconcile(events, targetDate);
    const reconciled = { ...reconcilerRaw, hotel: hotelMeta.id };

    for (const entry of reconcilerRaw.reasoningEntries) {
      logger.addReasoning(entry);
    }

    // Rebuild logger with the resolved shift label so the final emit logs the correct night.
    const loggerWithNight = new RequestLogger(hotelMeta.id, reconciled.targetShift);
    const finalLogger = new RequestLogger(hotelMeta.id, reconciled.targetShift);
    finalLogger.setEventsIngested(events.length);
    for (const id of flaggedIds) finalLogger.addFlagged(id);
    for (const entry of reconcilerRaw.reasoningEntries) finalLogger.addReasoning(entry);

    // 7. Generate
    finalLogger.setStage('generator');

    let responseBody: string;
    let contentTypeHeader: string;
    let statusCode: 200 = 200;

    if (format === 'json') {
      const output = await generateSections(reconciled, hotelMeta);
      responseBody = JSON.stringify(output, null, 2);
      contentTypeHeader = 'application/json';
    } else {
      const html = await generateHandover(reconciled, hotelMeta);
      responseBody = html;
      contentTypeHeader = 'text/html; charset=utf-8';
    }

    finalLogger.setStage('generator').emit('info');

    if (format === 'json') {
      return new Response(responseBody, {
        status: statusCode,
        headers: { 'Content-Type': contentTypeHeader },
      });
    }
    return c.html(responseBody, statusCode);

  } catch (err) {
    logger.setStage('handler').setError(err).emit('error');

    const message =
      err instanceof Error ? err.message : 'Internal server error';

    const safeMessage = message.includes('OPENAI_API_KEY')
      ? 'OpenAI API key is not configured. Set OPENAI_API_KEY in the environment.'
      : 'An error occurred generating the handover report. Check server logs.';

    if (format === 'json') {
      return c.json({ error: safeMessage }, 500);
    }

    const errorHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Handover Error</title>
  <style>
    body { font-family: sans-serif; padding: 40px; background: #fff5f5; color: #333; }
    h1 { color: #c53030; }
    p { margin-top: 12px; color: #555; }
  </style>
</head>
<body>
  <h1>Error generating handover report</h1>
  <p>${safeMessage}</p>
</body>
</html>`;
    return c.html(errorHtml, 500);
  }
}
