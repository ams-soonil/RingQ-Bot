import { useEffect, useState } from 'react';
import type { TestCase } from '@ringq/shared';
import { fetchCases, patchCase, addManualCase, confirmCases } from './api.js';

export function CaseReview({ runId, onConfirmed }: { runId: string; onConfirmed: () => void }) {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCases(runId).then(setCases).catch((e) => setError(String(e)));
  }, [runId]);

  async function toggle(c: TestCase) {
    try {
      const next = c.status === 'rejected' ? 'draft' : 'rejected';
      const updated = await patchCase(runId, c.id, { status: next });
      setCases((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (e) {
      setError(String(e));
    }
  }

  async function addFlow() {
    if (!title || !target) return;
    try {
      const created = await addManualCase(runId, title, [{ action: 'click', target }]);
      setCases((prev) => [...prev, created]);
      setTitle('');
      setTarget('');
    } catch (e) {
      setError(String(e));
    }
  }

  async function confirm() {
    try {
      await confirmCases(runId);
      onConfirmed();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h2>테스트 케이스 검수 ({cases.length})</h2>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <ul>
        {cases.map((c) => (
          <li key={c.id} style={{ opacity: c.status === 'rejected' ? 0.45 : 1 }}>
            <strong>[{c.type}]</strong> {c.title}{' '}
            <span style={{ fontSize: 12, color: '#888' }}>({c.source})</span>{' '}
            <button onClick={() => toggle(c)}>{c.status === 'rejected' ? '복원' : '거부'}</button>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input placeholder="수동 플로우 제목" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="클릭 대상(요소/화면 이름)" value={target} onChange={(e) => setTarget(e.target.value)} />
        <button onClick={addFlow} disabled={!title || !target}>플로우 추가</button>
      </div>
      <button style={{ marginTop: 16 }} onClick={confirm}>확정하고 계속 ▶</button>
    </section>
  );
}
