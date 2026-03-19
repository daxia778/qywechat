#!/bin/bash
# ═══════════════════════════════════════════════════
# 单管家 - 自动备份脚本
# 用法: bash deploy/backup.sh
# 建议配合 crontab 定时执行:
#   0 3 * * * cd /path/to/project && bash deploy/backup.sh >> /var/log/pdd-backup.log 2>&1
# ═══════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="pdd-backup-${TIMESTAMP}"
KEEP_COUNT=7  # 保留最近 7 份备份

# ─── 颜色输出 ───
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${YELLOW}[WARN]${NC} $1"; }

# ─── 创建备份目录 ───
mkdir -p "${BACKUP_DIR}"

info "开始备份: ${BACKUP_NAME}"

# ─── 1. SQLite 热备份 (不中断服务) ───
DB_FILE="${PROJECT_DIR}/data/pdd_order.db"
BACKUP_DB="${BACKUP_DIR}/${BACKUP_NAME}.db"

if [ -f "$DB_FILE" ]; then
    info "SQLite 热备份中..."
    if command -v sqlite3 &> /dev/null; then
        sqlite3 "$DB_FILE" ".backup '${BACKUP_DB}'"
        info "SQLite 备份完成: ${BACKUP_DB} ($(du -h "${BACKUP_DB}" | cut -f1))"
    else
        # 如果没有 sqlite3 命令，直接复制 (需确保没有写入)
        cp "$DB_FILE" "$BACKUP_DB"
        warn "未安装 sqlite3 CLI, 使用文件拷贝 (建议安装: apt install sqlite3)"
    fi
else
    # Docker 容器内的数据库，使用 docker cp
    CONTAINER_ID=$(docker ps -q --filter "ancestor=$(docker compose -f "${PROJECT_DIR}/docker-compose.lite.yml" images -q app 2>/dev/null)" 2>/dev/null || true)
    if [ -n "$CONTAINER_ID" ]; then
        info "从 Docker 容器中备份数据库..."
        docker exec "$CONTAINER_ID" sqlite3 /app/data/pdd_order.db ".backup '/tmp/backup.db'" 2>/dev/null || true
        docker cp "$CONTAINER_ID:/tmp/backup.db" "$BACKUP_DB" 2>/dev/null || true
        if [ -f "$BACKUP_DB" ]; then
            info "Docker 容器数据库备份完成"
        else
            warn "无法从容器备份，跳过数据库"
        fi
    else
        warn "未找到数据库文件: ${DB_FILE}"
    fi
fi

# ─── 2. 打包完整备份 (数据 + 上传文件 + 配置) ───
BACKUP_TAR="${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"
info "打包完整备份..."

cd "$PROJECT_DIR"

# 构建打包文件列表
FILES_TO_BACKUP=""
[ -d "data" ] && FILES_TO_BACKUP="$FILES_TO_BACKUP data/"
[ -d "uploads" ] && FILES_TO_BACKUP="$FILES_TO_BACKUP uploads/"
[ -f ".env" ] && FILES_TO_BACKUP="$FILES_TO_BACKUP .env"

if [ -n "$FILES_TO_BACKUP" ]; then
    tar czf "$BACKUP_TAR" $FILES_TO_BACKUP
    info "完整备份: ${BACKUP_TAR} ($(du -h "${BACKUP_TAR}" | cut -f1))"
else
    warn "没有找到需要备份的文件"
fi

# 清理单独的 db 备份文件 (已包含在 tar 中)
[ -f "$BACKUP_DB" ] && rm -f "$BACKUP_DB"

# ─── 3. 清理旧备份 ───
BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/pdd-backup-*.tar.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "$KEEP_COUNT" ]; then
    DELETE_COUNT=$((BACKUP_COUNT - KEEP_COUNT))
    info "清理旧备份 (保留最近 ${KEEP_COUNT} 份, 删除 ${DELETE_COUNT} 份)..."
    ls -1t "${BACKUP_DIR}"/pdd-backup-*.tar.gz | tail -n "$DELETE_COUNT" | xargs rm -f
    info "旧备份已清理"
fi

# ─── 4. 备份摘要 ───
echo ""
echo "════════════════════════════════════════"
echo "  📦 备份完成!"
echo "════════════════════════════════════════"
echo ""
echo "  最新备份: ${BACKUP_TAR}"
echo "  当前备份数: $(ls -1 "${BACKUP_DIR}"/pdd-backup-*.tar.gz 2>/dev/null | wc -l)/${KEEP_COUNT}"
echo ""
echo "  📥 同步到本地 Mac 命令:"
echo "  rsync -avz root@120.26.139.90:${BACKUP_DIR}/ ~/Desktop/pdd-backups/"
echo ""
echo "  🔄 迁移到新服务器:"
echo "  1. scp ${BACKUP_TAR} root@NEW_SERVER:/path/to/project/"
echo "  2. ssh root@NEW_SERVER"
echo "  3. cd /path/to/project && tar xzf ${BACKUP_NAME}.tar.gz"
echo "  4. docker compose -f docker-compose.lite.yml up -d"
echo ""
