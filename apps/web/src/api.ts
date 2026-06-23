import type { ProjectInput, Run } from '@ringq/shared';

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
