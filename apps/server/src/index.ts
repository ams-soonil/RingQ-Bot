import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { buildApp } from './app.js';
import { createStore } from './store.js';
import { createQueue } from './queue.js';
import { createPipeline } from './pipeline.js';
import { createFigmaClient } from './figma/client.js';
import { createCaseGenerator } from './cases/generator.js';
import { createAnthropicLLM } from './llm/anthropic.js';

mkdirSync('data', { recursive: true });
const store = createStore('data/ringq.db');
const figma = createFigmaClient({ token: process.env.FIGMA_TOKEN ?? '' });
const llm = createAnthropicLLM({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });
const generator = createCaseGenerator(llm);
const queue = createQueue(createPipeline({ store, figma, generator }, { delayMs: 300 }));
const app = buildApp({ store, queue });

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`[ringq] server listening on http://localhost:${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
