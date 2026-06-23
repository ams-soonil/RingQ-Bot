import { z } from 'zod';

export const RunPhaseSchema = z.enum([
  'queued',
  'generating-cases',
  'running',
  'comparing',
  'reporting',
  'done',
  'failed',
]);
export type RunPhase = z.infer<typeof RunPhaseSchema>;

export const RunStatusSchema = z.enum(['active', 'done', 'failed']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const ProjectInputSchema = z.object({
  figmaLinks: z.array(z.string().url()).min(1),
  siteUrl: z.string().url(),
  gitUrl: z.string().url().optional(),
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export const RunSchema = z.object({
  id: z.string(),
  siteUrl: z.string(),
  figmaLinks: z.array(z.string()),
  gitUrl: z.string().optional(),
  phase: RunPhaseSchema,
  status: RunStatusSchema,
  createdAt: z.string(),
});
export type Run = z.infer<typeof RunSchema>;

export const ProgressEventSchema = z.object({
  runId: z.string(),
  phase: RunPhaseSchema,
  message: z.string(),
  at: z.string(),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
