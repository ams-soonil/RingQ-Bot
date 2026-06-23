import { useEffect, useState } from 'react';
import type { RunCapture } from '@ringq/shared';
import { fetchCaptures } from './api.js';

export function Captures({ runId }: { runId: string }) {
  const [caps, setCaps] = useState<RunCapture[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetchCaptures(runId).then(setCaps).catch((e) => setError(String(e)));
  }
  useEffect(load, [runId]);

  return (
    <section style={{ marginTop: 24 }}>
      <h2>캡처 결과 ({caps.length}) <button onClick={load}>새로고침</button></h2>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <div style={{ display: 'grid', gap: 16 }}>
        {caps.map((c) => (
          <article key={c.caseId} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
            <div>
              <strong>[{c.type}]</strong> {c.url}
              {c.type === 'flow' && <span> · 플로우 {c.flowOk ? '성공' : '실패'}</span>}
              {c.error && <span style={{ color: 'crimson' }}> · {c.error}</span>}
            </div>
            {c.screenshotPath && (
              <img
                src={`/api/runs/${runId}/captures/${c.caseId}/screenshot`}
                alt={c.caseId}
                style={{ maxWidth: '100%', marginTop: 8, border: '1px solid #eee' }}
              />
            )}
            {c.texts.length > 0 && (
              <p style={{ fontSize: 12, color: '#666' }}>추출 텍스트: {c.texts.slice(0, 8).join(' · ')}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
