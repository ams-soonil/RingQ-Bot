# RingQ-Bot Plan 6 · 대시보드 UI 개편 + 폼 기반 계정 Implementation Plan

> 컨트롤러 직접 구현(서브에이전트 월한도 회피). 백엔드(creds)는 TDD, UI는 build 검증.

**Goal:** (1) 사이트 로그인 계정을 서버 env 대신 **실행 폼에서 입력**받아 per-run 저장하고 runner가 그 creds를 사용한다(결정 A, 비밀번호는 API 응답 Run에서 노출 안 함). (2) 대시보드 UI를 **헤더 + 사이드바 + 메인** 레이아웃, 푸른색 테마로 개편하고 입력(URL·Figma·계정·Git)을 사이드바에, 결과(진행·검수·리포트·결함·캡처)를 메인에 노출한다.

**Architecture:** creds는 `runs`와 분리된 `credentials(run_id PK, username, password)` 테이블에 저장 → `Run`(API 응답) 객체에는 비밀번호가 안 들어감. runner는 `store.getCredentials(runId)`로 읽어 로그인(있으면 시도, 없으면 스킵 — 기존 결정 C 유지). UI는 단일 `App.tsx`를 레이아웃 컴포넌트로 재구성 + `index.css`로 테마.

## Global Constraints

- TS ESM Node 22. vitest, `src/**/*.test.ts`. 타입은 `@ringq/shared`.
- 비밀번호는 `credentials` 테이블에만; `Run`/리포트/캡처 등 API 응답에 절대 포함 금지.
- 시크릿/data/db/dist 커밋 금지. 커밋 이모지 컨벤션 + Co-Authored-By.
- pnpm은 레포 루트.

---

### Task 1: shared — ProjectInput에 계정 추가

**Files:** `packages/shared/src/index.ts`, `index.test.ts`.

`ProjectInputSchema`에 `username: z.string().optional()`, `password: z.string().optional()` 추가. `RunSchema`는 그대로(비번 비노출).

- [ ] Step1 테스트(계정 포함 입력 통과, 없어도 통과). Step2 RED. Step3 구현. Step4 GREEN. Step5 commit `✨ ringq: ProjectInput에 사이트 계정(선택) 추가`.

---

### Task 2: store — credentials 테이블

**Files:** `store.ts`, `store.test.ts`.

- `credentials(run_id TEXT PRIMARY KEY, username TEXT, password TEXT)` 테이블.
- `createRun(input)`: input.username/password 둘 다 있으면 credentials에 저장(없으면 미저장). Run 반환은 그대로(비번 없음).
- `getCredentials(runId): { username: string; password: string } | undefined`.
- Store 인터페이스에 `getCredentials` 추가.

- [ ] Step1 테스트: createRun에 username/password 주면 getCredentials로 조회됨; 없으면 undefined; Run 객체엔 password 필드 없음. Step2 RED. Step3 구현. Step4 GREEN+tsc. Step5 commit `✨ ringq: store에 per-run credentials 저장/조회 추가`.

---

### Task 3: runner — store creds 사용 (env 제거)

**Files:** `runner/runner.ts`, `runner/runner.test.ts`, `index.ts`.

- `createRunner({store, driver}, opts?: { artifactDir? })` — `opts.creds` 제거.
- `run(runId)`: `const creds = store.getCredentials(runId)`; `if (creds?.username && creds?.password)` 로그인 시도(기존 로직과 동일, 'failed'면 throw).
- runner.test: 로그인 관련 두 테스트를 `store.saveCredentials`(없으면 createRun에 username/password 넣어 seed) 기반으로 갱신. (store에 saveCredentials 공개가 없으면, 테스트는 `store.createRun({..., username, password})`로 seed.)
- index.ts: `createRunner({ store, driver })` (env creds 인자 제거). `SITE_USERNAME/PASSWORD` env 참조 삭제.

> 주의: 이 변경으로 runner 생성 시그니처가 바뀌므로 index.ts를 같은 커밋에서 갱신. pipeline/app.test는 `createRunner({store, driver}, {artifactDir})`만 쓰므로 creds opt 제거 영향 없음(이미 creds 안 넘김).

- [ ] Step1 runner.test 갱신(creds는 createRun에 주입). Step2 RED. Step3 runner.ts + index.ts. Step4 GREEN+full+tsc. Step5 commit `♻️ ringq: runner가 env 대신 per-run credentials 사용`.

---

### Task 4: web — createRun에 계정/Git 전달 + 입력 상태

**Files:** `apps/web/src/api.ts`(변경 없음 — ProjectInput가 이미 username/password 포함), `App.tsx`(입력 상태 추가), `api.test.ts`(선택).

- `App.tsx`에 `username`, `password` 입력 상태 추가(gitUrl 이미 있음). `createRun` 호출에 `username: username || undefined, password: password || undefined` 전달.

(UI 레이아웃은 Task 5에서. 이 태스크는 데이터 전달만.)

- [ ] Step1 App에 상태+전달 추가. Step2 build 확인. Step3 commit (Task 5와 합쳐서 커밋 가능 — 분리 불필요시 Task5에 통합).

---

### Task 5: web — 대시보드 레이아웃 + 푸른 테마

**Files:** `apps/web/src/index.css`(신규), `main.tsx`(css import), `App.tsx`(레이아웃 재구성).

- `index.css`: CSS 변수 `--blue: #2563eb`(primary), 배경/사이드바/카드 색, 기본 타이포. 헤더(상단 바, 브랜드 + 푸른 배경), `.layout`(grid: sidebar 280px + main), `.sidebar`(입력 폼 카드), `.main`(결과 영역), `.card`, `.btn-primary`(푸른 버튼) 등 클래스.
- `main.tsx`: `import './index.css';`.
- `App.tsx`: 구조를 `<header> + <div class=layout><aside class=sidebar>(입력 폼)</aside><main class=main>(진행/검수/리포트/결함/캡처)</main></div>`로 재구성. 입력: Figma 링크, 사이트 URL, 사이트 ID, 사이트 비밀번호(type=password), (선택) Git URL, "QA 실행" 버튼(푸른). 결과 컴포넌트(진행 리스트, CaseReview, ReportView, Findings, Captures)는 메인에 그대로 배치. 기능/SSE/상태 로직은 유지(레이아웃·클래스만 변경).

- [ ] Step1 index.css 작성. Step2 main.tsx css import. Step3 App.tsx 레이아웃 재구성(+계정 입력). Step4 `pnpm --filter @ringq/web test`(api 11 유지) + `pnpm --filter @ringq/web build` 성공. Step5 commit `✨ ringq: web 대시보드 레이아웃(헤더+사이드바+메인) + 푸른 테마 + 계정 입력`.

---

### Task 6: README + 검증

- [ ] `.env.example`에서 `SITE_USERNAME/PASSWORD`는 "(이제 대시보드 폼에서 입력)" 주석으로 남기거나 유지(하위호환). README "현재 상태"에 UI 개편 + 폼 계정 한 줄 추가.
- [ ] 전체 `pnpm -r test` + server tsc + web build 그린.
- [ ] data/ 미커밋 확인. commit `📑 ringq: 대시보드 UI 개편 README 반영`.

---

## Self-Review
- 폼 계정(결정 A) → T1(입력) + T2(저장, 비번 비노출) + T3(runner 사용) + T4(전달). ✅
- 헤더+사이드바+메인 + 푸른 테마 → T5. ✅
- 비번 비노출: credentials 별도 테이블, Run/응답에 미포함 → T2. ✅
- 타입 일관성: ProjectInput(shared) → web createRun/server. runner 시그니처 변경 → index 동일 커밋.
- 기능 회귀 방지: SSE/검수/결과 로직 유지, 레이아웃·클래스만 변경(T5).
