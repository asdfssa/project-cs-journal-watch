# Journal Watch — Angular frontend + Node backend + Playwright (chromium) + noVNC debug stack

# ── Stage 1: build Angular (context "frontend" มาจาก additional_contexts ใน docker-compose.yml)
FROM node:20-alpine AS frontend-build
WORKDIR /fe
COPY --from=frontend package.json package-lock.json ./
RUN npm ci
COPY --from=frontend angular.json tsconfig.json tsconfig.app.json ./
COPY --from=frontend src ./src
COPY --from=frontend public ./public
RUN npm run build

# ── Stage 2: backend (เสิร์ฟ frontend จาก /app/frontend ด้วย Express)
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb fluxbox x11vnc x11-utils git python3 ca-certificates curl procps build-essential \
    && rm -rf /var/lib/apt/lists/*

# noVNC + websockify (startup.sh expects /opt/novnc/utils/novnc_proxy)
RUN git clone --depth 1 https://github.com/novnc/noVNC.git /opt/novnc \
    && git clone --depth 1 https://github.com/novnc/websockify /opt/novnc/utils/websockify

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium

COPY . .
COPY --from=frontend-build /fe/dist/journal/browser ./frontend
RUN chmod +x docker/novnc/startup.sh

EXPOSE 3000 5900 6080

CMD ["./docker/novnc/startup.sh"]
