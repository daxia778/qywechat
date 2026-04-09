#!/bin/bash
# ═══════════════════════════════════════════════════
# PDD 派单管理系统 - 一键构建脚本
# 用法: ./build.sh [server|client|admin|all]
# ═══════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/release"
mkdir -p "$BUILD_DIR"

# ─── 颜色输出 ───
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ─── 构建服务端 ───
build_server() {
  info "构建服务端..."
  cd "$SCRIPT_DIR/server"

  # 交叉编译: Linux amd64 (部署到服务器)
  info "  → Linux amd64"
  GOOS=linux GOARCH=amd64 go build -o "$BUILD_DIR/pdd-server-linux-amd64" .

  # 本机 macOS arm64
  info "  → macOS arm64"
  GOOS=darwin GOARCH=arm64 go build -o "$BUILD_DIR/pdd-server-darwin-arm64" .

  info "服务端构建完成 ✅"
}

# ─── 构建管理端前端 ───
build_admin() {
  info "构建管理端前端 (Vue3)..."
  cd "$SCRIPT_DIR/admin-web"

  npm ci --silent 2>/dev/null || warn "npm ci 可能有警告"
  npm run build

  info "管理端前端构建完成 ✅ → admin-web/dist/"
}

# ─── 构建桌面客服端 ───
build_client() {
  info "构建桌面客服端 (Wails)..."
  cd "$SCRIPT_DIR/desktop-client"

  if ! command -v wails &> /dev/null; then
    error "未安装 wails CLI，请先执行: go install github.com/wailsapp/wails/v2/cmd/wails@latest"
  fi

  # macOS 本机构建
  info "  → macOS .app"
  wails build -platform darwin/arm64 -o "PDD派单助手"
  if [ -d "build/bin/PDD派单助手.app" ]; then
    cp -r "build/bin/PDD派单助手.app" "$BUILD_DIR/"
    info "  macOS .app 已复制到 release/"
  fi

  # Windows 交叉编译 (需要安装 mingw-w64)
  if command -v x86_64-w64-mingw32-gcc &> /dev/null; then
    info "  → Windows .exe"
    wails build -platform windows/amd64 -o "PDD派单助手.exe"
    if [ -f "build/bin/PDD派单助手.exe" ]; then
      cp "build/bin/PDD派单助手.exe" "$BUILD_DIR/"
      info "  Windows .exe 已复制到 release/"
    fi
  else
    warn "跳过 Windows 构建 (未安装 mingw-w64 交叉编译器)"
    warn "安装方法: brew install mingw-w64"
  fi

  info "桌面客服端构建完成 ✅"
}

# ─── 主流程 ───
TARGET="${1:-all}"

case "$TARGET" in
  server)  build_server ;;
  admin)   build_admin ;;
  client)  build_client ;;
  all)
    build_admin
    build_server
    build_client
    echo ""
    info "═══════════════════════════════════════"
    info "全部构建完成！产物在 release/ 目录"
    info "═══════════════════════════════════════"
    ls -lh "$BUILD_DIR/"
    ;;
  *)
    echo "用法: $0 [server|admin|client|all]"
    exit 1
    ;;
esac
