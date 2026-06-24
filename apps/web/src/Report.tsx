import { useEffect, useState } from 'react';
import type { Report } from '@ringq/shared';
import { fetchReport } from './api.js';

export function ReportView({ runId }: { runId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetchReport(runId)
      .then(setReport)
      .catch((e) => setError(String(e)));
  }
  useEffect(load, [runId]);

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>;
  if (!report) return null;

  const pass = report.verdict === 'pass';
  return (
    <section style={{ marginTop: 24 }}>
      <h2>
        QA 리포트 <button onClick={load}>새로고침</button>
      </h2>
      <div
        style={{
          display: 'inline-block',
          padding: '4px 12px',
          borderRadius: 6,
          color: '#fff',
          background: pass ? '#16a34a' : '#b00020',
          fontWeight: 700,
        }}
      >
        {report.verdict.toUpperCase()}
      </div>
      <p>
        총 {report.total}건 · critical {report.critical} · major {report.major} · minor {report.minor}
      </p>
      {report.suggestion && (
        <details open>
          <summary>수정 가이드</summary>
          <pre
            style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: '#f6f8fa', padding: 12, borderRadius: 6 }}
          >
            {report.suggestion}
          </pre>
        </details>
      )}
    </section>
  );
}
