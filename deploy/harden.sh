#!/bin/bash
# ═══════════════════════════════════════════════════
# 单管家 - 服务器一键安全加固脚本
# 适用于: Ubuntu 20.04+ / Debian 11+ (阿里云 ECS)
# 用法: sudo bash deploy/harden.sh
# ═══════════════════════════════════════════════════

set -e

# ─── 颜色输出 ───
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✅]${NC} $1"; }
warn()  { echo -e "${YELLOW}[⚠️]${NC} $1"; }
error() { echo -e "${RED}[❌]${NC} $1"; exit 1; }

# ─── 检查 root 权限 ───
if [ "$(id -u)" -ne 0 ]; then
    error "请使用 sudo 运行此脚本: sudo bash $0"
fi

echo ""
echo "══════════════════════════════════════════"
echo "  🛡️  单管家 - 服务器安全加固"
echo "══════════════════════════════════════════"
echo ""

# ════════════════════════════════════════════
# 1. 系统更新
# ════════════════════════════════════════════
info "正在更新系统包..."
apt-get update -qq
apt-get upgrade -y -qq
info "系统已更新"

# ════════════════════════════════════════════
# 2. 安装安全工具
# ════════════════════════════════════════════
info "安装安全工具 (fail2ban, ufw, unattended-upgrades)..."
apt-get install -y -qq fail2ban ufw unattended-upgrades apt-listchanges

# ════════════════════════════════════════════
# 3. SSH 加固
# ════════════════════════════════════════════
info "加固 SSH 配置..."
SSHD_CONFIG="/etc/ssh/sshd_config"

# 备份原始配置
cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%Y%m%d)"

# 安全设置 (不改端口，避免阿里云安全组不一致导致锁死)
apply_ssh_setting() {
    local key="$1"
    local value="$2"
    if grep -q "^${key}" "$SSHD_CONFIG"; then
        sed -i "s/^${key}.*/${key} ${value}/" "$SSHD_CONFIG"
    elif grep -q "^#${key}" "$SSHD_CONFIG"; then
        sed -i "s/^#${key}.*/${key} ${value}/" "$SSHD_CONFIG"
    else
        echo "${key} ${value}" >> "$SSHD_CONFIG"
    fi
}

# 禁用 root 密码登录 (密钥仍可用)
apply_ssh_setting "PermitRootLogin" "prohibit-password"
# 禁止空密码
apply_ssh_setting "PermitEmptyPasswords" "no"
# 最大认证尝试次数
apply_ssh_setting "MaxAuthTries" "3"
# 登录超时 30 秒
apply_ssh_setting "LoginGraceTime" "30"
# 最大并发未认证连接数 (防 SSH DoS)
apply_ssh_setting "MaxStartups" "3:50:10"
# 禁用不安全的协议
apply_ssh_setting "Protocol" "2"
# 会话超时 (10分钟无操作断开)
apply_ssh_setting "ClientAliveInterval" "300"
apply_ssh_setting "ClientAliveCountMax" "2"

# 重启 SSH
systemctl restart sshd
info "SSH 加固完成 (root 仅密钥登录, 最大尝试 3 次, 30s 超时)"

# ════════════════════════════════════════════
# 4. fail2ban 配置
# ════════════════════════════════════════════
info "配置 fail2ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
# 封禁时长: 1 小时
bantime = 3600
# 观察窗口: 10 分钟
findtime = 600
# 最大失败次数
maxretry = 5
# 忽略本地回环
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 7200

# HTTP 暴力破解防护 (监控应用日志中的 429 响应)
[pdd-app]
enabled = true
port = 8200
filter = pdd-app
logpath = /var/log/syslog
maxretry = 20
findtime = 300
bantime = 3600
EOF

# 创建自定义 fail2ban 过滤器 (匹配应用安全日志)
cat > /etc/fail2ban/filter.d/pdd-app.conf << 'EOF'
[Definition]
failregex = 🛡️ 拦截可疑请求: IP=<HOST>
            🛡️ 拦截恶意 UA: IP=<HOST>
            🚨 安全告警: IP <HOST>
            🚨 IP 白名单拦截: IP=<HOST>
ignoreregex =
EOF

systemctl enable fail2ban
systemctl restart fail2ban
info "fail2ban 已启用 (SSH: 3次/封2h, HTTP: 20次/封1h)"

# ════════════════════════════════════════════
# 5. UFW 防火墙
# ════════════════════════════════════════════
info "配置 UFW 防火墙..."

# 默认策略: 拒绝所有入站，允许所有出站
ufw default deny incoming
ufw default allow outgoing

# 放行 SSH (22)
ufw allow ssh

# 放行应用端口 (8200)
ufw allow 8200/tcp comment 'PDD App'

# 放行 Docker 网络 (内部通信)
ufw allow from 172.16.0.0/12 comment 'Docker internal'

# 启用 UFW (非交互模式)
echo "y" | ufw enable
info "UFW 已启用 (仅放行 SSH + 8200)"

# ════════════════════════════════════════════
# 6. 内核安全参数
# ════════════════════════════════════════════
info "优化内核安全参数..."
cat > /etc/sysctl.d/99-security.conf << 'EOF'
# ── SYN Flood 防护 ──
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2

# ── 禁用 ICMP 重定向 (防中间人) ──
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv6.conf.all.accept_redirects = 0

# ── 禁用源路由 (防 IP 欺骗) ──
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0

# ── 启用反向路径过滤 (防 IP 伪造) ──
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# ── 忽略 ICMP 广播 (防 Smurf 攻击) ──
net.ipv4.icmp_echo_ignore_broadcasts = 1

# ── 记录异常包 ──
net.ipv4.conf.all.log_martians = 1
EOF

sysctl -p /etc/sysctl.d/99-security.conf > /dev/null 2>&1
info "内核安全参数已优化"

# ════════════════════════════════════════════
# 7. 自动安全更新
# ════════════════════════════════════════════
info "启用自动安全更新..."
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

info "自动安全更新已启用"

# ════════════════════════════════════════════
# 8. 最终状态报告
# ════════════════════════════════════════════
echo ""
echo "══════════════════════════════════════════"
echo "  🛡️  安全加固完成！"
echo "══════════════════════════════════════════"
echo ""
echo "  ✅ SSH: root 仅密钥, MaxAuth=3, 30s 超时"
echo "  ✅ fail2ban: SSH(3次/封2h) + App(20次/封1h)"
echo "  ✅ UFW: 仅 SSH + 8200 端口"
echo "  ✅ 内核: SYN Cookie + 反向路径过滤"
echo "  ✅ 自动更新: 每日安全补丁"
echo ""
echo "  📋 查看状态命令:"
echo "    fail2ban-client status"
echo "    ufw status verbose"
echo "    sshd -T | grep -E 'permit|max|login'"
echo ""
warn "请确保你已配置 SSH 密钥登录，否则可能被锁在外面！"
warn "阿里云安全组也需要放行 8200 端口"
echo ""
