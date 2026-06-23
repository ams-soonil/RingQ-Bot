# RingQ-Bot

Figma 기획서를 정답지로 삼아 실제 사이트의 UI 일치 + 사용자 플로우를 자동 QA하는 로컬 우선 대시보드.

## 개발 실행

```bash
cp .env.example .env   # 키 채우기 (Plan 2부터 필요)
pnpm install
pnpm dev               # server :4000 + web :5173 동시 구동
```

브라우저에서 http://localhost:5173 접속 → Figma 링크 + 사이트 URL 입력 → "QA 실행".

> **현재 상태(Plan 1):** Phase는 스텁으로 진행상황만 스트리밍됩니다. 실제 Figma 분석/Playwright 실행/비교는 Plan 2~5에서 구현됩니다.

## 테스트

```bash
pnpm test
```
