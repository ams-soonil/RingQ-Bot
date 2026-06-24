import { useEffect, useState } from 'react';
import type { Finding, Report, RunCapture, Severity, TestCase } from '@ringq/shared';
import { fetchReport, fetchCases, fetchFindings, fetchCaptures } from './api.js';

const SEV: Record<Severity, { color: string; label: string; dot: string; emoji: string }> = {
  success: { color: '#16a34a', label: '성공', dot: '✓', emoji: '🟢' },
  improvement: { color: '#2563eb', label: '개선', dot: 'ℹ', emoji: '🔵' },
  warning: { color: '#d97706', label: '경고', dot: '!', emoji: '🟡' },
  issue: { color: '#b00020', label: '이슈', dot: '✕', emoji: '🔴' },
};
const RANK: Record<Severity, number> = { success: 0, improvement: 1, warning: 2, issue: 3 };

/** 화면 카드의 대표 상태 = 가장 높은 레벨(없으면 success). */
function worst(findings: Finding[]): Severity {
  let w: Severity = 'success';
  for (const f of findings) if (RANK[f.severity] > RANK[w]) w = f.severity;
  return w;
}

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
            {SEV.issue.emoji} {findings.filter((f) => f.severity === 'issue').length} ·{' '}
            {SEV.warning.emoji} {findings.filter((f) => f.severity === 'warning').length} ·{' '}
            {SEV.improvement.emoji} {findings.filter((f) => f.severity === 'improvement').length} ·{' '}
            {SEV.success.emoji} {findings.filter((f) => f.severity === 'success').length}
          </div>
        </div>
        <span className="qa-donut" style={{ borderColor: SEV[status].color }} />
        <span className="qa-chevron">{open ? '▾' : '▸'}</span>
      </header>
      {open && (
        <div className="qa-card-body">
          {findings.length === 0 ? (
            <div className="qa-finding" style={{ borderLeftColor: '#94a3b8' }}>
              <span className="qa-msg">검증 결과 없음 (이 화면에 해당하는 실제 화면을 찾지 못했을 수 있음)</span>
            </div>
          ) : (
            [...findings]
              .sort((a, b) => RANK[b.severity] - RANK[a.severity])
              .map((f) => (
                <div key={f.id} className="qa-finding" style={{ borderLeftColor: SEV[f.severity].color }}>
                  <div className="qa-finding-head">
                    <span className="qa-sev-badge" style={{ background: SEV[f.severity].color }}>
                      {SEV[f.severity].emoji} {SEV[f.severity].label}
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
