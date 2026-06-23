import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { buildApp } from './app.js';
import { createStore } from './store.js';
import { createQueue } from './queue.js';
import { createSkeletonPipeline } from './pipeline.js';

mkdirSync('data', { recursive: true });
const store = createStore('data/ringq.db');
const queue = createQueue(createSkeletonPipeline(store, { delayMs: 300 }));
const app = buildApp({ store, queue });

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`[ringq] server listening on http://localhost:${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
