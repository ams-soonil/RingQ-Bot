# RingQ-Bot 설계 문서

> QA 자동화 + 링닥 = **RingQ-Bot**
> 작성일: 2026-06-23

## 0. 한 줄 정의

Git 소스 · Figma 기획서 · 실행 중인 사이트를 입력받아, **기획서(Figma)를 정답지로 삼아 실제 화면의 UI 일치와 사용자 플로우 동작을 자동 검사**하고, QA 리포트와 (베스트에포트) 코드 수정 제안을 대시보드에서 보여주는 로컬 우선 웹 앱.

## 1. 확정된 핵심 결정

| 항목 | 결정 | 비고 |
|---|---|---|
| 검사 범위 | UI 일치 + 플로우 동작 (둘 다) | Q1 = C |
| 형태 | 대시보드 웹 UI (입력 → 실행 → 진행 → 결과 한 화면) | Q2 = A |
| 출력 | QA 리포트(필수) + 코드 수정 제안(베스트에포트) | Q3 = A 필수 + B 베스트에포트 |
| 테스트 케이스 | Figma 자동 추출 → 사용자 검수·수정 (하이브리드) | Q4 = C |
| 실행 환경 | 로컬 우선 + 서버 이식 가능한 상시 Node 프로세스 구조 | Q5 = C |
| 비교 엔진 | 풀 하이브리드 (구조 diff 결정론 + 비전 LLM) | Q6 = C |

### v1 스코프 컷 (YAGNI)

- ❌ 멀티유저 / 인증
- ❌ 스케줄링 / CI 트리거
- ❌ 자동 PR 생성
- ✅ 단일 로컬 사용자, 계정은 `.env`, 한 번에 한 프로젝트 (데이터 모델만 멀티 프로젝트 대비)

## 2. 아키텍처

```
[React 대시보드] ──SSE(진행상황)── [Fastify 상시 서버]
                                        │
                                   [잡 워커]  ← 서버리스 ❌, 상시 프로세스 ✅
                                        │
   ┌───────────────┬──────────────┬────┴──────────┬───────────────┐
figma-client    runner        comparator       code-suggester   store
(REST API)   (Playwright)  (구조diff+비전)    (Git+LLM, 베스트)  (SQLite+fs)
                                  │
                            Claude (Anthropic SDK)
```

- **로컬 우선**: `pnpm dev` 한 줄로 React + Fastify 동시 구동. Playwright가 로컬 브라우저 직접 구동.
- **서버 이식성**: 백엔드는 서버리스가 아닌 **상시 Node 프로세스 + 잡 워커**. 잡 큐는 추상화(인메모리 → 추후 Redis/BullMQ 교체) → Railway/Fly로 코드 거의 그대로 이동.
- **해커톤 교훈 차단**: Playwright + LLM 판단은 수십 초~수 분 걸리는 장시간 stateful 작업 → 서버리스(타임아웃 + 브라우저 바이너리 불가)와 근본적으로 상극이라 구조적으로 배제.

### 기술 스택

TypeScript / pnpm 모노레포 / Vite + React / Fastify / Playwright / `@anthropic-ai/sdk` / better-sqlite3 / simple-git / zod.

## 3. QA Run 흐름

1. **입력** — Figma 링크, 대상 사이트 URL, 로그인 계정(`.env`), (선택) Git repo URL.
2. **Phase 1 · 케이스 생성 (하이브리드)**
   - `figma-client`가 노드 트리 + 프로토타입 연결 + 렌더 이미지 수집.
   - `case-generator`(Claude)가 테스트 케이스 초안 자동 생성: 화면별 UI 기대값(요소·텍스트·핵심 토큰) + 플로우 시나리오(프로토타입 연결 기반).
   - 사용자가 대시보드에서 검수·수정·추가 후 **확정**.
3. **Phase 2 · 실행 (Playwright)**
   - `.env` 계정으로 로그인 → 확정 시나리오대로 이동.
   - 화면별: 스크린샷 + DOM 추출(텍스트·computed style·요소 존재).
   - 플로우: 클릭/입력 액션 수행 후 이동/상태 검증.
4. **Phase 3 · 비교 (하이브리드 엔진)**
   - **구조 diff (결정론)**: 추출 텍스트 · 필수 요소 · 핵심 색 토큰 ↔ Figma 구조 데이터 → 정밀 불일치.
   - **비전 LLM**: 실제 스크린샷 + Figma 프레임 이미지를 Claude 비전에 전달 → 레이아웃/시각 인상 불일치 + 플로우 성공 판정.
   - 두 결과 병합 → 심각도 부여된 finding 목록.
5. **Phase 4 · 리포트 + 코드 제안**
   - 리포트: finding(스크린샷 쌍 + "Figma는 X / 실제는 Y" + 심각도).
   - 베스트에포트: `code-suggester`가 finding → Git 소스 파일 매핑(grep + LLM) → 수정 diff 제안.
   - 대시보드에 렌더, 아티팩트는 디스크 영속.

## 4. 컴포넌트 (각자 한 가지 책임 · 독립 테스트 가능)

| 유닛 | 책임 | 의존 |
|---|---|---|
| `figma-client` | 노드 트리 · 프로토타입 연결 · 이미지 fetch | Figma REST API |
| `case-generator` | Figma 데이터 → 테스트 케이스 초안 | Claude |
| `runner` | 로그인 · 이동 · 스크린샷 · DOM 추출 · 플로우 실행 | Playwright |
| `comparator` | `structural-diff`(결정론) + `vision-judge`(LLM) 병합 | Claude |
| `code-suggester` | finding → repo 파일 매핑 → diff 제안 | simple-git, Claude |
| `report-builder` | finding 조립 · 심각도 산정 | — |
| `queue` / `worker` | Run 생명주기 · 진행 이벤트 발행 | — |
| `api`(Fastify) + SSE | 입력 · 트리거 · 진행 스트림 · 결과 제공 | — |
| `web`(React) | 입력 폼 · 케이스 검수 UI · 진행 표시 · 결과 뷰 | — |
| `store` | Run / 결과 / 아티팩트 영속화 | SQLite + fs |

**경계 기준**: 각 유닛은 "무엇을 하는가 / 어떻게 쓰는가 / 무엇에 의존하는가"가 명확. 내부 구현을 바꿔도 소비자가 깨지지 않도록 인터페이스로 통신.

## 5. 데이터 모델

- **Project** `{ id, gitUrl?, figmaLinks[], siteUrl, credsRef }`
- **Run** `{ id, projectId, status, phase, createdAt }`
- **TestCase** `{ id, runId, type: 'ui' | 'flow', figmaNodeId, expectations, steps[], status }`
- **Finding** `{ id, runId, caseId, category, severity, figmaEvidence, actualScreenshot, description, suggestedFix? }`

## 6. 에러 처리 (해커톤 교훈 반영)

- **단계 · 케이스 격리**: 케이스 하나가 실패해도 Run 전체가 죽지 않음 (부분 결과 보존).
- **아티팩트 즉시 디스크 영속** → 크래시 / 네트워크 단절에도 진행분 보존. **Run은 Phase 단위 재개 가능**.
- 로그인 실패 → 명확한 메시지로 즉시 중단.
- LLM / Figma / 사이트 도달 불가 → 백오프 재시도 후 부분 결과 노출 (silent failure 금지, 에러는 항상 표면화).

## 7. 테스트 전략

- **단위**: `structural-diff`(fixture 기반 결정론 검증), `case-generator` 파싱, `figma-client` 매핑.
- **통합**: 샘플/fixture 사이트 대상 `runner`, 녹화된 Figma + 스크린샷 fixture로 `comparator`.
- LLM / Figma API는 테스트에서 mock.

## 8. 시크릿 / 설정

- `.env`: `ANTHROPIC_API_KEY`, `FIGMA_TOKEN`, 대상 사이트 `SITE_USERNAME` / `SITE_PASSWORD`.
- 시크릿은 절대 커밋 금지. `.env.example`만 제공.
