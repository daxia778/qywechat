# ── 多阶段构建（支持多架构） ─────────────────
# Stage 1: 前端构建
FROM --platform=$BUILDPLATFORM node:20.18-alpine3.20 AS frontend
WORKDIR /build/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Stage 2: Go 后端构建
FROM --platform=$BUILDPLATFORM golang:1.24.1-alpine3.20 AS backend
ARG TARGETOS=linux
ARG TARGETARCH=amd64
WORKDIR /build/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /pdd-server .

# Stage 3: 最终运行镜像
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Shanghai

WORKDIR /app
RUN addgroup -S pdd && adduser -S pdd -G pdd

COPY --from=backend /pdd-server .
COPY --from=frontend /build/web/dist ./web/dist

# 创建数据目录
RUN mkdir -p /app/data /app/uploads

RUN chown -R pdd:pdd /app
USER pdd

EXPOSE 8201

ENTRYPOINT ["./pdd-server"]
