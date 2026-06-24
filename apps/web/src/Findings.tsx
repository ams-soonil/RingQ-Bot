import { useEffect, useState } from 'react';
import type { Finding } from '@ringq/shared';
import { fetchFindings } from './api.js';

const ORDER: Record<string, number> = { critical: 0, major: 1, minor: 2 };
const COLOR: Record<string, string> = { critical: '#b00020', major: '#d97706', minor: '#6b7280' };

export function Findings({ runId }: { runId: string }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetchFindings(runId)
      .then(setFindings)
      .catch((e) => setError(String(e)));
  }
  useEffect(load, [runId]);

  const sorted = [...findings].sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9));

  return (
    <section style={{ marginTop: 24 }}>
      <h2>
        이슈 ({findings.length}) <button onClick={load}>새로고침</button>
      </h2>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {findings.length === 0 && !error && <p>이슈 없음 ✅</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {sorted.map((f) => (
          <li
            key={f.id}
            style={{ borderLeft: `4px solid ${COLOR[f.severity] ?? '#999'}`, padding: '6px 12px', marginBottom: 6 }}
          >
            <strong style={{ color: COLOR[f.severity] ?? '#999' }}>{f.severity.toUpperCase()}</strong>{' '}
            <span style={{ fontSize: 12, color: '#888' }}>
              [{f.source}/{f.category}]
            </span>{' '}
            <span>· {f.caseId}</span>
            <div>{f.message}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
