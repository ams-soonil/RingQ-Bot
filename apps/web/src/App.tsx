import { useRef, useState } from 'react';
import type { ProgressEvent, Run } from '@ringq/shared';
import { createRun } from './api.js';
import { QaReport } from './QaReport.js';

const PHASE_LABEL: Record<string, string> = {
  queued: '대기',
  'generating-cases': '케이스 생성',
  'cases-confirmed': '케이스 확정',
  running: '화면 캡처',
  comparing: '비교',
  reporting: '리포트',
  done: '완료',
  failed: '실패',
};

export function App() {
  const [figmaLink, setFigmaLink] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  async function onRun() {
    esRef.current?.close();
    esRef.current = null;
    setError(null);
    setEvents([]);
    setDone(false);
    setBusy(true);
    try {
      const created = await createRun({
        figmaLinks: [figmaLink],
        siteUrl,
        gitUrl: gitUrl || undefined,
        username: username || undefined,
        password: password || undefined,
      });
      setRun(created);
      const es = new EventSource(`/api/runs/${created.id}/events`);
      esRef.current = es;
      es.addEventListener('progress', (e) => {
        const ev = JSON.parse((e as MessageEvent).data) as ProgressEvent;
        setEvents((prev) => [...prev, ev]);
        if (ev.phase === 'done') setDone(true);
        if (ev.phase === 'done' || ev.phase === 'failed') {
          setBusy(false);
          es.close();
          esRef.current = null;
        }
      });
      es.onerror = () => {
        setBusy(false);
        es.close();
        esRef.current = null;
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : '실행 실패');
      setBusy(false);
    }
  }

  const lastPhase = events.length ? events[events.length - 1].phase : null;

  return (
    <>
      <header className="app-header">
        <span className="brand">🤖 RingQ-Bot</span>
        <span className="tagline">Figma 기획서를 정답지로 사이트를 자동 QA하는 대시보드</span>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="card">
            <h2>QA 실행</h2>
            <div className="field">
              <label>Figma 링크</label>
              <input placeholder="https://figma.com/design/..." value={figmaLink} onChange={(e) => setFigmaLink(e.target.value)} />
            </div>
            <div className="field">
              <label>대상 사이트 URL</label>
              <input placeholder="https://example.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
            </div>
            <div className="field">
              <label>사이트 계정 ID (선택)</label>
              <input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="field">
              <label>사이트 비밀번호 (선택)</label>
              <input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label>Git repo URL (선택)</label>
              <input placeholder="https://github.com/..." value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} />
            </div>
            <button className="btn-primary" onClick={onRun} disabled={!figmaLink || !siteUrl || busy}>
              {busy ? '실행 중…' : 'QA 실행'}
            </button>
            {error && <p className="error">{error}</p>}
          </div>

          {run && (
            <div className="card">
              <h3>진행 상황 {lastPhase && <span className="phase">· {PHASE_LABEL[lastPhase] ?? lastPhase}</span>}</h3>
              <ol className="progress-list">
                {events.map((ev, i) => (
                  <li key={i}>
                    <span className="phase">{PHASE_LABEL[ev.phase] ?? ev.phase}</span>
                    {ev.message}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>

        <main className="main">
          {!run && (
            <div className="card empty">
              왼쪽에 Figma 링크와 사이트 URL을 입력하고 <strong>QA 실행</strong>을 눌러 시작하세요.
            </div>
          )}
          {run && !done && (
            <div className="card empty">
              QA 실행 중… (진행 상황은 왼쪽에서 확인)
            </div>
          )}
          {run && done && <QaReport runId={run.id} />}
        </main>
      </div>
    </>
  );
}
