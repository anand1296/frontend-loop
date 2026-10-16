# Production image: one small binary serving the API and the built frontend.
# Build: docker build -t frontend-loop .    Run: see docker-compose.yml

# 1. Frontend (Vite)
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build:web

# 2. Backend (Go, static binary)
FROM golang:1.24-alpine AS api
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/server ./cmd/server

# 3. Runtime: distroless, non-root, no shell
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=api /out/server /app/server
COPY --from=web /app/dist /app/dist
ENV PORT=8080 STATIC_DIR=/app/dist
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/app/server"]
