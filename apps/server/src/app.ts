import Fastify, { type FastifyInstance } from 'fastify';
import { ProjectInputSchema } from '@ringq/shared';
import type { Store } from './store.js';
import type { JobQueue } from './queue.js';
import { runEvents } from './events.js';
import type { ProgressEvent } from '@ringq/shared';

export function buildApp(deps: { store: Store; queue: JobQueue }): FastifyInstance {
  const { store, queue } = deps;
  const app = Fastify({ logger: false });

  app.post('/api/runs', async (req, reply) => {
    const parsed = ProjectInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const run = store.createRun(parsed.data);
    queue.enqueue(run.id);
    return reply.code(201).send(run);
  });

  app.get('/api/runs', async () => store.listRuns());

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const run = store.getRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'not found' });
    return run;
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/events', (req, reply) => {
    const run = store.getRun(req.params.id);
    if (!run) {
      reply.code(404).send({ error: 'not found' });
      return;
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.on('error', () => {});
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(run)}\n\n`);

    const onProgress = (ev: ProgressEvent) => {
      if (reply.raw.writableEnded) {
        runEvents.off(req.params.id, onProgress);
        return;
      }
      reply.raw.write(`event: progress\ndata: ${JSON.stringify(ev)}\n\n`);
      if (ev.phase === 'done' || ev.phase === 'failed') {
        runEvents.off(req.params.id, onProgress);
        reply.raw.end();
      }
    };
    runEvents.on(req.params.id, onProgress);
    req.raw.on('close', () => runEvents.off(req.params.id, onProgress));
  });

  return app;
}
