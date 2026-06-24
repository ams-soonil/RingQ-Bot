import { z } from 'zod';

export const RunPhaseSchema = z.enum([
  'queued',
  'generating-cases',
  'awaiting-review',
  'cases-confirmed',
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
  username: z.string().optional(),
  password: z.string().optional(),
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

export const TestCaseTypeSchema = z.enum(['ui', 'flow']);
export type TestCaseType = z.infer<typeof TestCaseTypeSchema>;

export const TestCaseSourceSchema = z.enum(['figma', 'manual']);
export type TestCaseSource = z.infer<typeof TestCaseSourceSchema>;

export const TestCaseStatusSchema = z.enum(['draft', 'confirmed', 'rejected']);
export type TestCaseStatus = z.infer<typeof TestCaseStatusSchema>;

export const UiExpectationSchema = z.object({
  texts: z.array(z.string()),
  elements: z.array(z.string()),
  colors: z.array(z.string()),
});
export type UiExpectation = z.infer<typeof UiExpectationSchema>;

export const FlowStepSchema = z.object({
  action: z.enum(['navigate', 'click', 'expect']),
  target: z.string(),
  note: z.string().optional(),
});
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const TestCaseSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: TestCaseTypeSchema,
  source: TestCaseSourceSchema,
  status: TestCaseStatusSchema,
  title: z.string(),
  figmaNodeId: z.string().optional(),
  routePath: z.string().optional(),
  uiExpectation: UiExpectationSchema.optional(),
  steps: z.array(FlowStepSchema).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const RunCaptureSchema = z.object({
  caseId: z.string(),
  runId: z.string(),
  type: TestCaseTypeSchema,
  url: z.string(),
  texts: z.array(z.string()),
  elements: z.array(z.string()),
  screenshotPath: z.string().optional(),
  flowOk: z.boolean().optional(),
  error: z.string().optional(),
});
export type RunCapture = z.infer<typeof RunCaptureSchema>;

// 4단계 결과 레벨: 성공(🟢)/개선(🔵)/경고(🟡)/이슈(🔴)
// - success: 기획서와 동일
// - improvement: 기능 영향 없는 경미한 시각 차이(여백·색상·간격·폰트 등)
// - warning: 기능 또는 가독성에 영향
// - issue: 핵심 기능 누락, 화면 깨짐, 검증 불가
export const SeveritySchema = z.enum(['success', 'improvement', 'warning', 'issue']);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingSourceSchema = z.enum(['structural', 'vision']);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  runId: z.string(),
  caseId: z.string(),
  category: z.string(),
  severity: SeveritySchema,
  message: z.string(),
  source: FindingSourceSchema,
});
export type Finding = z.infer<typeof FindingSchema>;

export const VerdictSchema = z.enum(['pass', 'fail']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const ReportSchema = z.object({
  runId: z.string(),
  total: z.number(),
  success: z.number(),
  improvement: z.number(),
  warning: z.number(),
  issue: z.number(),
  verdict: VerdictSchema,
  generatedAt: z.string(),
  suggestion: z.string().optional(),
});
export type Report = z.infer<typeof ReportSchema>;
