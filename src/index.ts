import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import handoverRouter from './routes/handover.js';

// Load .env for local dev; Railway injects env vars directly so .env won't exist there.
const envPath = join(fileURLToPath(new URL('.', import.meta.url)), '..', '.env');
if (typeof process.loadEnvFile === 'function' && existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const app = new Hono();

app.get('/health', (c) =>
  c.json({ status: 'ok', ts: new Date().toISOString() })
);

app.route('/handover', handoverRouter);

const port = Number(process.env['PORT'] ?? 3000);

serve({ fetch: app.fetch, port }, () => {
  process.stdout.write(`handover-api listening on port ${port}\n`);
});

export default app;
