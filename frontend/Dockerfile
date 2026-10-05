# ── Stage 1: Build the Angular app ──────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Install deps first (separate layer so Docker can cache this when only
# source files change, not package.json)
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source and build the production bundle
COPY . .
RUN npm run build

# ── Stage 2: Serve the static build with Nginx ──────────────────────
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/journal/browser /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
