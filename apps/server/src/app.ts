import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { ProjectInputSchema, TestCaseSchema, FlowStepSchema } from '@ringq/shared';
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

  app.get<{ Params: { id: string } }>('/api/runs/:id/cases', async (req, reply) => {
    if (!store.getRun(req.params.id)) return reply.code(404).send({ error: 'not found' });
    return store.listCases(req.params.id);
  });

  const CasePatchSchema = TestCaseSchema.pick({
    title: true,
    status: true,
    uiExpectation: true,
    steps: true,
  }).partial();

  app.patch<{ Params: { id: string; caseId: string } }>(
    '/api/runs/:id/cases/:caseId',
    async (req, reply) => {
      if (!store.getRun(req.params.id)) return reply.code(404).send({ error: 'not found' });
      const parsed = CasePatchSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
      const exists = store.listCases(req.params.id).some((c) => c.id === req.params.caseId);
      if (!exists) return reply.code(404).send({ error: 'case not found' });
      return store.updateCase(req.params.caseId, parsed.data);
    },
  );

  const ManualCaseSchema = z.object({
    title: z.string().min(1),
    steps: z.array(FlowStepSchema).min(1),
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/cases', async (req, reply) => {
    if (!store.getRun(req.params.id)) return reply.code(404).send({ error: 'not found' });
    const parsed = ManualCaseSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const rand = Math.random().toString(36).slice(2, 8);
    const created = store.addCase({
      id: `tc_${req.params.id}_manual_${rand}`,
      runId: req.params.id,
      type: 'flow',
      source: 'manual',
      status: 'draft',
      title: parsed.data.title,
      steps: parsed.data.steps,
    });
    return reply.code(201).send(created);
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/captures', async (req, reply) => {
    if (!store.getRun(req.params.id)) return reply.code(404).send({ error: 'not found' });
    return store.listCaptures(req.params.id);
  });

  app.get<{ Params: { id: string; caseId: string } }>(
    '/api/runs/:id/captures/:caseId/screenshot',
    async (req, reply) => {
      const cap = store.listCaptures(req.params.id).find((c) => c.caseId === req.params.caseId);
      if (!cap?.screenshotPath || !existsSync(cap.screenshotPath)) {
        return reply.code(404).send({ error: 'screenshot not found' });
      }
      return reply.type('image/png').send(readFileSync(cap.screenshotPath));
    },
  );

  app.get<{ Params: { id: string } }>('/api/runs/:id/findings', async (req, reply) => {
    if (!store.getRun(req.params.id)) return reply.code(404).send({ error: 'not found' });
    return store.listFindings(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/confirm', async (req, reply) => {
    const run = store.getRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'not found' });
    if (run.phase !== 'awaiting-review') {
      return reply.code(409).send({ error: `run is not awaiting review (phase: ${run.phase})` });
    }
    store.confirmCases(req.params.id);
    const updated = store.updateRun(req.params.id, { phase: 'cases-confirmed' });
    queue.enqueue(req.params.id);
    return updated;
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
