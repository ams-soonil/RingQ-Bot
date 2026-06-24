# RingQ-Bot

Figma 기획서를 정답지로 삼아 실제 사이트의 UI 일치 + 사용자 플로우를 자동 QA하는 로컬 우선 대시보드.

## 개발 실행

```bash
cp .env.example .env   # ANTHROPIC_API_KEY, FIGMA_TOKEN 채우기
pnpm install
pnpm dev               # server :4000 + web :5173 동시 구동
```

브라우저에서 http://localhost:5173 접속 → 좌측 사이드바에 **Figma 링크 · 사이트 URL · (선택) 사이트 계정 · (선택) Git URL** 입력 → "QA 실행". 결과(진행 → 케이스 검수 → 리포트/결함/캡처)는 메인 영역에 표시됩니다.

> **UI:** 헤더 + 사이드바(입력) + 메인(결과)의 푸른색 대시보드. **사이트 로그인 계정은 서버 env가 아니라 실행 폼에서 per-run 입력**하며, 비밀번호는 별도 테이블에만 저장되고 API 응답에는 노출되지 않습니다.

> **현재 상태(Plan 5):** 전체 파이프라인이 완성됐습니다 — Phase 1(Figma→케이스→검수/확정) → Phase 2(Playwright 캡처) → Phase 3(하이브리드 비교: 구조 diff + 비전 LLM) → Phase 4(리포트). 비교가 끝나면 결함을 종합해 **QA 리포트**(심각도 집계 + 합격/불합격 verdict)를 만들고, 결함이 있으면 **경량 코드 수정 가이드(Claude, repo 접근 없음)** 를 베스트에포트로 덧붙입니다. 대시보드에서 "QA 리포트"(PASS/FAIL 배지·집계·수정 가이드) + "결함" + "캡처 결과"를 봅니다.
>
> 최초 1회 브라우저 설치 필요: `pnpm --filter @ringq/server exec playwright install chromium`

## 테스트

```bash
pnpm test
```
