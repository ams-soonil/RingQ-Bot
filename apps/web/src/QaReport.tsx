import { useEffect, useState } from 'react';
import type { Finding, Report, RunCapture, TestCase } from '@ringq/shared';
import { fetchReport, fetchCases, fetchFindings, fetchCaptures } from './api.js';

type CaseStatus = 'pass' | 'warn' | 'fail';

function caseStatus(findings: Finding[]): CaseStatus {
  if (findings.some((f) => f.severity === 'critical' || f.severity === 'major')) return 'fail';
  if (findings.length > 0) return 'warn';
  return 'pass';
}

const SEV_COLOR: Record<string, string> = { critical: '#b00020', major: '#d97706', minor: '#6b7280' };

function CaseCard({
  tc,
  findings,
  capture,
  runId,
}: {
  tc: TestCase;
  findings: Finding[];
  capture?: RunCapture;
  runId: string;
}) {
  const [open, setOpen] = useState(true);
  const status = caseStatus(findings);
  return (
    <article className={`qa-card qa-${status}`}>
      <header className="qa-card-head" onClick={() => setOpen((v) => !v)}>
        <div className="qa-card-title">
          <div className="qa-card-name">{tc.title}</div>
          <div className="qa-card-sub">
            [{tc.type}]{tc.figmaNodeId ? ` · ${tc.figmaNodeId}` : ''}
          </div>
          <div className="qa-card-meta">
            결함 {findings.length} · {status === 'pass' ? '통과' : status === 'warn' ? '경미' : '실패'}
          </div>
        </div>
        <span className={`qa-donut qa-donut-${status}`} />
        <span className="qa-chevron">{open ? '▾' : '▸'}</span>
      </header>
      {open && (
        <div className="qa-card-body">
          {findings.length === 0 ? (
            <div className="qa-finding qa-finding-pass" style={{ borderLeftColor: '#16a34a' }}>
              <span className="qa-dot qa-dot-pass">✓</span>
              <span className="qa-msg">설계 디스크립션 충족 — 결함 없음</span>
            </div>
          ) : (
            findings.map((f) => (
              <div key={f.id} className="qa-finding" style={{ borderLeftColor: SEV_COLOR[f.severity] ?? '#999' }}>
                <div className="qa-finding-head">
                  <span className="qa-sev-badge" style={{ background: SEV_COLOR[f.severity] ?? '#999' }}>
                    {f.severity.toUpperCase()}
                  </span>
                  <span className="qa-cat">[{f.source}/{f.category}]</span>
                </div>
                <div className="qa-msg">{f.message}</div>
              </div>
            ))
          )}
          {capture?.screenshotPath && (
            <details className="qa-shot">
              <summary>실제 화면 스크린샷</summary>
              <img src={`/api/runs/${runId}/captures/${tc.id}/screenshot`} alt={tc.id} />
            </details>
          )}
        </div>
      )}
    </article>
  );
}

export function QaReport({ runId }: { runId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [captures, setCaptures] = useState<RunCapture[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    Promise.all([fetchReport(runId), fetchCases(runId), fetchFindings(runId), fetchCaptures(runId)])
      .then(([r, c, f, cap]) => {
        setReport(r);
        setCases(c);
        setFindings(f);
        setCaptures(cap);
      })
      .catch((e) => setError(String(e)));
  }
  useEffect(load, [runId]);

  const findingsByCase = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = findingsByCase.get(f.caseId) ?? [];
    arr.push(f);
    findingsByCase.set(f.caseId, arr);
  }
  const captureByCase = new Map(captures.map((c) => [c.caseId, c]));
  const confirmed = cases.filter((c) => c.status === 'confirmed');
  const failed = confirmed.filter((c) => caseStatus(findingsByCase.get(c.id) ?? []) === 'fail').length;
  const passed = confirmed.length - failed;
  const allPass = failed === 0;

  return (
    <div className="qa-report">
      <div className={`qa-report-head ${allPass ? 'ok' : 'bad'}`}>
        <div className="qa-report-title">QA 리포트 {report && <span className={`badge badge-${report.verdict === 'pass' ? 'pass' : 'fail'}`}>{report.verdict.toUpperCase()}</span>}</div>
        <div className="qa-stats">
          <span className="qa-stat">📋 {confirmed.length} 화면</span>
          <span className="qa-stat ok">✓ {passed}</span>
          <span className="qa-stat bad">✕ {failed}</span>
          <button className="btn" onClick={load}>새로고침</button>
        </div>
      </div>
      <div className={`qa-report-bar ${allPass ? 'ok' : 'bad'}`} />

      {error && <p className="error">{error}</p>}
      {report?.suggestion && (
        <details className="card qa-guide" open>
          <summary>💡 코드 수정 가이드</summary>
          <pre>{report.suggestion}</pre>
        </details>
      )}

      <div className="qa-cards">
        {confirmed.map((tc) => (
          <CaseCard
            key={tc.id}
            tc={tc}
            findings={findingsByCase.get(tc.id) ?? []}
            capture={captureByCase.get(tc.id)}
            runId={runId}
          />
        ))}
      </div>
    </div>
  );
}
