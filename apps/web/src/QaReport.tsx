import { useEffect, useState } from 'react';
import type { Finding, Report, RunCapture, Severity, TestCase } from '@ringq/shared';
import { fetchReport, fetchCases, fetchFindings, fetchCaptures } from './api.js';

const SEV: Record<Severity, { color: string; label: string; emoji: string }> = {
  success: { color: '#16a34a', label: '성공', emoji: '🟢' },
  improvement: { color: '#2563eb', label: '개선', emoji: '🔵' },
  warning: { color: '#d97706', label: '경고', emoji: '🟡' },
  issue: { color: '#b00020', label: '이슈', emoji: '🔴' },
};
const RANK: Record<Severity, number> = { success: 0, improvement: 1, warning: 2, issue: 3 };

function worst(findings: Finding[]): Severity {
  let w: Severity = 'success';
  for (const f of findings) if (RANK[f.severity] > RANK[w]) w = f.severity;
  return w;
}

/** 이슈별 큰 박스. 성공은 텍스트만, 그 외는 상세 토글(설명 + 코드 수정 가이드). */
function FindingItem({ f }: { f: Finding }) {
  const sev = SEV[f.severity];
  const isSuccess = f.severity === 'success';
  const [open, setOpen] = useState(f.severity === 'issue' || f.severity === 'warning');
  return (
    <article className="qa-finding" style={{ borderLeftColor: sev.color }}>
      <div className="qa-finding-title" style={{ color: sev.color }}>
        {sev.emoji} {f.title || f.category}
        <span className="qa-finding-cat">[{f.source}/{f.category}]</span>
      </div>
      {isSuccess ? (
        <div className="qa-msg">{f.message}</div>
      ) : (
        <>
          <button className="qa-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? '▾' : '▸'} 상세 내용
          </button>
          {open && (
            <div className="qa-detail">
              <div className="qa-msg">{f.message}</div>
              {f.fix && (
                <div className="qa-fix">
                  <div className="qa-fix-label">💡 코드 수정 가이드</div>
                  <pre>{f.fix}</pre>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}

function CaseCard({ tc, findings, capture, runId }: { tc: TestCase; findings: Finding[]; capture?: RunCapture; runId: string }) {
  const [open, setOpen] = useState(true);
  const status = worst(findings);
  return (
    <article className="qa-card">
      <header className="qa-card-head" onClick={() => setOpen((v) => !v)}>
        <div className="qa-card-title">
          <div className="qa-card-name">{tc.title}</div>
          <div className="qa-card-sub">
            [{tc.type}]{tc.figmaNodeId ? ` · ${tc.figmaNodeId}` : ''}
          </div>
          <div className="qa-card-meta">
            {SEV.issue.emoji} {findings.filter((f) => f.severity === 'issue').length} · {SEV.warning.emoji}{' '}
            {findings.filter((f) => f.severity === 'warning').length} · {SEV.improvement.emoji}{' '}
            {findings.filter((f) => f.severity === 'improvement').length} · {SEV.success.emoji}{' '}
            {findings.filter((f) => f.severity === 'success').length}
          </div>
        </div>
        <span className="qa-donut" style={{ borderColor: SEV[status].color }} />
        <span className="qa-chevron">{open ? '▾' : '▸'}</span>
      </header>
      {open && (
        <div className="qa-card-body">
          {findings.length === 0 ? (
            <article className="qa-finding" style={{ borderLeftColor: '#94a3b8' }}>
              <div className="qa-msg">검증 결과 없음 (이 화면에 해당하는 실제 화면을 찾지 못했을 수 있음)</div>
            </article>
          ) : (
            [...findings]
              .sort((a, b) => RANK[b.severity] - RANK[a.severity])
              .map((f) => <FindingItem key={f.id} f={f} />)
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
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  const allPass = report ? report.verdict === 'pass' : count('warning') + count('issue') === 0;

  return (
    <div className="qa-report">
      <div className={`qa-report-head ${allPass ? 'ok' : 'bad'}`}>
        <div className="qa-report-title">
          QA 리포트
          {report && (
            <span className={`badge badge-${report.verdict === 'pass' ? 'pass' : 'fail'}`}>
              {report.verdict === 'pass' ? 'PASS' : 'FAIL'}
            </span>
          )}
        </div>
        <div className="qa-stats">
          <span className="qa-stat">📋 {confirmed.length} 화면</span>
          <span className="qa-stat">{SEV.issue.emoji} {count('issue')}</span>
          <span className="qa-stat">{SEV.warning.emoji} {count('warning')}</span>
          <span className="qa-stat">{SEV.improvement.emoji} {count('improvement')}</span>
          <span className="qa-stat">{SEV.success.emoji} {count('success')}</span>
          <button className="btn" onClick={load}>새로고침</button>
        </div>
      </div>
      <div className={`qa-report-bar ${allPass ? 'ok' : 'bad'}`} />

      {error && <p className="error">{error}</p>}

      <div className="qa-cards">
        {confirmed.map((tc) => (
          <CaseCard key={tc.id} tc={tc} findings={findingsByCase.get(tc.id) ?? []} capture={captureByCase.get(tc.id)} runId={runId} />
        ))}
      </div>
    </div>
  );
}
