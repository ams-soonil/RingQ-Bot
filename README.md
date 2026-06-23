# RingQ-Bot

Figma 기획서를 정답지로 삼아 실제 사이트의 UI 일치 + 사용자 플로우를 자동 QA하는 로컬 우선 대시보드.

## 개발 실행

```bash
cp .env.example .env   # 키 채우기 (Plan 2부터 필요)
pnpm install
pnpm dev               # server :4000 + web :5173 동시 구동
```

브라우저에서 http://localhost:5173 접속 → Figma 링크 + 사이트 URL 입력 → "QA 실행".

> **현재 상태(Plan 2):** Phase 1(Figma 분석 → 케이스 자동생성 → 검수/확정)이 동작합니다. `.env`에 `FIGMA_TOKEN`과 `ANTHROPIC_API_KEY`가 필요합니다. 실행 → 케이스가 `awaiting-review`에서 생성되면 대시보드에서 검수·수정·추가 후 "확정하고 계속"을 누르면 나머지 Phase(running→comparing→reporting, 아직 스텁)가 진행됩니다. 실제 Playwright 실행/비교는 Plan 3~ 에서 구현됩니다.

## 테스트

```bash
pnpm test
```
