import { useRef, useState } from 'react';
import type { ProgressEvent, Run } from '@ringq/shared';
import { createRun } from './api.js';

export function App() {
  const [figmaLink, setFigmaLink] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  async function onRun() {
    esRef.current?.close();
    esRef.current = null;
    setError(null);
    setEvents([]);
    try {
      const created = await createRun({
        figmaLinks: [figmaLink],
        siteUrl,
        gitUrl: gitUrl || undefined,
      });
      setRun(created);
      const es = new EventSource(`/api/runs/${created.id}/events`);
      esRef.current = es;
      es.addEventListener('progress', (e) => {
        const ev = JSON.parse((e as MessageEvent).data) as ProgressEvent;
        setEvents((prev) => [...prev, ev]);
        if (ev.phase === 'done' || ev.phase === 'failed') {
          es.close();
          esRef.current = null;
        }
      });
      es.onerror = () => {
        es.close();
        esRef.current = null;
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : '실행 실패');
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h1>🤖 RingQ-Bot</h1>
      <p>Figma 기획서를 정답지로 사이트를 자동 QA합니다.</p>
      <div style={{ display: 'grid', gap: 8 }}>
        <input placeholder="Figma 링크" value={figmaLink} onChange={(e) => setFigmaLink(e.target.value)} />
        <input placeholder="대상 사이트 URL" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
        <input placeholder="(선택) Git repo URL" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} />
        <button onClick={onRun} disabled={!figmaLink || !siteUrl}>QA 실행</button>
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {run && (
        <section style={{ marginTop: 24 }}>
          <h2>진행 상황 · {run.id}</h2>
          <ol>
            {events.map((ev, i) => (
              <li key={i}>
                <strong>{ev.phase}</strong> — {ev.message}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
