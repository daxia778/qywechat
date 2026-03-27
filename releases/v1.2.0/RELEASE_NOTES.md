# v1.2.0 稳定版 (2026-03-27)

## 新功能 & 改动

- Token 黑名单 + 刷新机制，密码重置即时注销
- 管理员订单转派功能（设计师重新分配）
- 统一错误码响应格式，消除内部错误信息泄露
- CI 增强：golangci-lint + gosec + ESLint + coverage
- 收款流水管理 + 企微对外收款自动同步
- 抢单监控告警系统
- 顾客管理与合并功能
- 批量订单状态更新（max 100）
- 设计超时 48h 告警（企微 + 站内 + WebSocket 三通道）
- Dashboard 查询优化（20+ → ~13 次 SQL）
- 激活码设备绑定系统优化

## 下载说明

### 服务器后端

| 文件 | 适用系统 |
|------|---------|
| `pdd-server-linux-amd64` | Linux x86_64（主流服务器） |
| `pdd-server-linux-arm64` | Linux ARM64（树莓派/ARM 服务器） |
| `pdd-server-darwin-arm64` | macOS Apple Silicon (M1/M2/M3/M4) |
| `pdd-server-darwin-amd64` | macOS Intel |
| `pdd-server-windows-amd64.exe` | Windows x64 |
| `pdd-server-windows-arm64.exe` | Windows ARM64 |

### 桌面客服端（单管家）

| 文件 | 适用设备 |
|------|---------|
| `单管家-Windows-x64.zip` | Windows x64（大部分 Windows 电脑） |
| `单管家-macOS-AppleSilicon.zip` | Mac M1/M2/M3/M4 芯片 |
| `单管家-macOS-Intel.zip` | 老款 Intel Mac |

### 前端

| 文件 | 说明 |
|------|------|
| `admin-web-dist.tar.gz` | 管理端前端静态文件 |

## 部署说明

```bash
# 后端部署（Linux）
scp pdd-server-linux-amd64 root@SERVER:/opt/pdd-server/pdd-server
ssh root@SERVER "chmod +x /opt/pdd-server/pdd-server && systemctl restart pdd-server"

# 前端部署
tar xzf admin-web-dist.tar.gz -C /tmp/dist
scp -r /tmp/dist/* root@SERVER:/opt/pdd-server/dist/
```

## 默认账号

- 管理员: `admin` / `admin888`（首次启动后请立即修改密码）
