import type { ProjectInput, Run, TestCase, FlowStep, RunCapture, Finding } from '@ringq/shared';

export async function createRun(input: ProjectInput): Promise<Run> {
  const res = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(`createRun 실패: ${JSON.stringify(body.error ?? res.status)}`);
  }
  return (await res.json()) as Run;
}

async function jsonOrThrow<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(`${what} 실패: ${JSON.stringify(body.error ?? res.status)}`);
  }
  return (await res.json()) as T;
}

export async function fetchCases(runId: string): Promise<TestCase[]> {
  return jsonOrThrow(await fetch(`/api/runs/${runId}/cases`), 'fetchCases');
}

export async function patchCase(
  runId: string,
  caseId: string,
  patch: Partial<Pick<TestCase, 'title' | 'status' | 'steps' | 'uiExpectation'>>,
): Promise<TestCase> {
  return jsonOrThrow(
    await fetch(`/api/runs/${runId}/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
    'patchCase',
  );
}

export async function addManualCase(runId: string, title: string, steps: FlowStep[]): Promise<TestCase> {
  return jsonOrThrow(
    await fetch(`/api/runs/${runId}/cases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, steps }),
    }),
    'addManualCase',
  );
}

export async function confirmCases(runId: string): Promise<Run> {
  return jsonOrThrow(await fetch(`/api/runs/${runId}/confirm`, { method: 'POST' }), 'confirmCases');
}

export async function fetchCaptures(runId: string): Promise<RunCapture[]> {
  return jsonOrThrow(await fetch(`/api/runs/${runId}/captures`), 'fetchCaptures');
}

export async function fetchFindings(runId: string): Promise<Finding[]> {
  return jsonOrThrow(await fetch(`/api/runs/${runId}/findings`), 'fetchFindings');
}
