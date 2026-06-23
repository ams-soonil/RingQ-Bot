import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { buildApp } from './app.js';
import { createStore } from './store.js';
import { createQueue } from './queue.js';
import { createPipeline } from './pipeline.js';
import { createFigmaClient } from './figma/client.js';
import { createAnthropicLLM } from './llm/anthropic.js';
import { createCaseGenerator } from './cases/generator.js';
import { createRunner } from './runner/runner.js';
import { createPlaywrightDriver } from './browser/playwright.js';
import { createComparator } from './compare/comparator.js';
import { createAnthropicVision } from './compare/vision-anthropic.js';

const figmaToken = process.env.FIGMA_TOKEN;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!figmaToken) {
  console.error('[ringq] FIGMA_TOKEN 환경변수가 필요합니다 (.env 참고)');
  process.exit(1);
}
if (!anthropicKey) {
  console.error('[ringq] ANTHROPIC_API_KEY 환경변수가 필요합니다 (.env 참고)');
  process.exit(1);
}

mkdirSync('data', { recursive: true });
const store = createStore('data/ringq.db');
const figma = createFigmaClient({ token: figmaToken });
const llm = createAnthropicLLM({ apiKey: anthropicKey });
const generator = createCaseGenerator(llm);
const driver = createPlaywrightDriver({ headless: true });
const runner = createRunner(
  { store, driver },
  { creds: { username: process.env.SITE_USERNAME, password: process.env.SITE_PASSWORD } },
);
const vision = createAnthropicVision({ apiKey: anthropicKey });
const comparator = createComparator({ store, figma, vision });
const queue = createQueue(createPipeline({ store, figma, generator, runner, comparator }, { delayMs: 300 }));
const app = buildApp({ store, queue });

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`[ringq] server listening on http://localhost:${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
