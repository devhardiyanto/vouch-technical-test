import OpenAI from 'openai';
import { z } from 'zod';

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY must not be empty'),
});

// Lazy singleton — throws only at call time, not at import time.
let _client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (_client) return _client;

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      'OPENAI_API_KEY is not set. Set it in your environment or .env file.'
    );
  }

  _client = new OpenAI({ apiKey: parsed.data.OPENAI_API_KEY });
  return _client;
}

export const MODEL = 'gpt-4o-mini' as const;
