# RingQ-Bot

Figma 기획서를 정답지로 삼아 실제 사이트의 UI 일치 + 사용자 플로우를 자동 QA하는 로컬 우선 대시보드.

## 개발 실행

```bash
cp .env.example .env   # ANTHROPIC_API_KEY, FIGMA_TOKEN 채우기
pnpm install
pnpm dev               # server :4000 + web :5173 동시 구동
```

브라우저에서 http://localhost:5173 접속 → 좌측 사이드바에 **Figma 링크 · 사이트 URL · (선택) 사이트 계정 · (선택) 진입 단계** 입력 → "QA 실행". 결과(진행 → 케이스 검수 → 리포트/결함/캡처)는 메인 영역에 표시됩니다.

> **UI:** 헤더 + 사이드바(입력) + 메인(결과)의 푸른색 대시보드. **사이트 로그인 계정은 서버 env가 아니라 실행 폼에서 per-run 입력**하며, 비밀번호는 별도 테이블에만 저장되고 API 응답에는 노출되지 않습니다.

> **현재 상태(Plan 5):** 전체 파이프라인이 완성됐습니다 — Phase 1(Figma→케이스→검수/확정) → Phase 2(Playwright 캡처) → Phase 3(하이브리드 비교: 구조 diff + 비전 LLM) → Phase 4(리포트). 비교가 끝나면 결함을 종합해 **QA 리포트**(심각도 집계 + 합격/불합격 verdict)를 만들고, 결함이 있으면 **경량 코드 수정 가이드(Claude, repo 접근 없음)** 를 베스트에포트로 덧붙입니다. 대시보드에서 "QA 리포트"(PASS/FAIL 배지·집계·수정 가이드) + "결함" + "캡처 결과"를 봅니다.
>
> 최초 1회 브라우저 설치 필요: `pnpm --filter @ringq/server exec playwright install chromium`

## 테스트

```bash
pnpm test
```

## 배포 / 공유 (Docker)

이 도구는 **Playwright로 실제 브라우저를 띄우고 better-sqlite3(네이티브)** 를 쓰므로 서버리스(Vercel/Netlify 등)에는 올릴 수 없고, **상시 떠 있는 컨테이너/VM**(사내 서버·Render·Railway·Fly.io·EC2 등) 또는 각 개발자 로컬에서 돌립니다. 브라우저가 포함된 공식 Playwright 이미지를 베이스로 하며, **하나의 컨테이너가 API와 빌드된 프론트를 같은 포트(4000)에서 같이 서빙**합니다.

```bash
cp .env.example .env       # ANTHROPIC_API_KEY, FIGMA_TOKEN 채우기
docker compose up -d --build
# → http://localhost:4000 접속 (프론트 + API 단일 서비스)
```

- `data/`(sqlite DB + 스크린샷)는 볼륨으로 영속화되어 컨테이너를 다시 만들어도 결과가 유지됩니다.
- 다른 개발자에게는 **이 레포 + 채운 `.env`** 만 공유하면 위 한 줄로 실행됩니다. (`.env`는 git/이미지에 포함되지 않으니 키는 별도 전달)
- 외부 호스트(Render/Railway/Fly.io 등)에 올릴 때도 같은 `Dockerfile`을 쓰고, `ANTHROPIC_API_KEY`/`FIGMA_TOKEN`은 해당 플랫폼의 환경변수(Secret)로 주입하세요.
- ⚠️ 공개 URL로 띄우면 누구나 QA 실행(=Anthropic 토큰 소비)을 트리거할 수 있으니, 사내망/접근제어 뒤에 두는 것을 권장합니다.

> 로컬에서 Docker 없이 프로덕션 방식으로 직접 확인하려면: `pnpm --filter @ringq/web build && pnpm --filter @ringq/server start` → http://localhost:4000
