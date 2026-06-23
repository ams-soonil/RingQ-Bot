# RingQ-Bot

Figma 기획서를 정답지로 삼아 실제 사이트의 UI 일치 + 사용자 플로우를 자동 QA하는 로컬 우선 대시보드.

## 개발 실행

```bash
cp .env.example .env   # 키 채우기 (Plan 2부터 필요)
pnpm install
pnpm dev               # server :4000 + web :5173 동시 구동
```

브라우저에서 http://localhost:5173 접속 → Figma 링크 + 사이트 URL 입력 → "QA 실행".

> **현재 상태(Plan 4):** Phase 1(Figma→케이스→검수/확정) + Phase 2(Playwright 캡처) + Phase 3(하이브리드 비교)가 동작합니다. 확정 후 runner가 화면을 캡처하면 comparator가 **구조 diff(텍스트/요소 누락·플로우 실패)** 와 **비전 LLM(Claude로 레이아웃/색/시각 비교)** 를 병합해 심각도(critical/major/minor)가 매겨진 결함 목록을 만들고, 대시보드의 "결함"에서 확인합니다. 리포트(reporting)는 아직 스텁이며 Plan 5에서 구현됩니다.
>
> 최초 1회 브라우저 설치 필요: `pnpm --filter @ringq/server exec playwright install chromium`

## 테스트

```bash
pnpm test
```
