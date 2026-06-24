# RingQ-Bot — Playwright(브라우저 포함) 베이스 이미지. playwright 버전과 태그를 맞춘다.
FROM mcr.microsoft.com/playwright:v1.61.0-jammy

WORKDIR /app

# better-sqlite3 네이티브 빌드(prebuilt 없을 때 소스 컴파일) 폴백용 툴체인
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# pnpm (corepack)
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

# 의존성 설치(워크스페이스 매니페스트 먼저 복사 → 레이어 캐시 활용)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# 소스 복사 후 웹만 빌드(vite). 서버/shared는 빌드 산출물 없이 tsx로 실행하는 구조.
COPY . .
RUN pnpm --filter @ringq/web build

# data/(sqlite + 스크린샷)는 서버 cwd(apps/server) 기준에 생성된다 → 볼륨으로 영속화.
VOLUME ["/app/apps/server/data"]
EXPOSE 4000
ENV PORT=4000

# 서버는 tsx로 실행(@ringq/shared는 원본 TS를 그대로 트랜스파일). cwd=apps/server.
CMD ["pnpm", "--filter", "@ringq/server", "start"]
