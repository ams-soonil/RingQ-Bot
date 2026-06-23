# RingQ-Bot

Figma 기획서를 정답지로 삼아 실제 사이트의 UI 일치 + 사용자 플로우를 자동 QA하는 로컬 우선 대시보드.

## 개발 실행

```bash
cp .env.example .env   # 키 채우기 (Plan 2부터 필요)
pnpm install
pnpm dev               # server :4000 + web :5173 동시 구동
```

브라우저에서 http://localhost:5173 접속 → Figma 링크 + 사이트 URL 입력 → "QA 실행".

> **현재 상태(Plan 3):** Phase 1(Figma→케이스→검수/확정) + Phase 2(확정 후 실제 Playwright 실행)이 동작합니다. 확정하면 runner가 사이트에 접속(`SITE_USERNAME`/`SITE_PASSWORD`가 있으면 휴리스틱 로그인, 없으면 스킵)해 케이스별로 화면을 캡처(스크린샷 + DOM 텍스트/요소)하고, 대시보드의 "캡처 결과"에서 스크린샷과 추출 내용을 봅니다. 비교(comparing)/리포트(reporting)는 아직 스텁이며 Plan 4~5에서 구현됩니다.
>
> 최초 1회 브라우저 설치 필요: `pnpm --filter @ringq/server exec playwright install chromium`

## 테스트

```bash
pnpm test
```
