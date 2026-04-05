# Desktop Client 桌面客服端指南（单管家）

Go + Wails v2 + Vue3 | 窗口 420×680 | macOS + Windows

## 用途
供客服/销售使用的桌面录单工具：激活码登录 → OCR 截图识单 → 选跟单客服 → 提交订单

## 文件结构
```
desktop-client/
├── main.go           # Wails 入口，窗口参数，macOS 标题栏透明化
├── app.go            # 核心业务，所有暴露给前端的 Wails 绑定方法
├── crypto.go         # 设备指纹生成 + AES-256-GCM 会话加解密
├── cgo_darwin.go     # macOS CGo 桩（UniformTypeIdentifiers 框架）
├── wails.json        # Wails 配置（应用名: 单管家）
└── frontend/
    └── src/App.vue   # 单文件应用（无路由，条件渲染切换登录/录单）
```

## Wails 绑定方法（app.go → 前端通过 window.go.main.App.* 调用）

### 认证
| 方法 | 说明 |
|------|------|
| `DeviceLogin(activationCode)` | 激活码 + 设备指纹登录，成功后持久化加密会话 |
| `IsLoggedIn()` | 返回是否已登录 |
| `GetEmployeeName()` | 返回已登录员工姓名 |
| `ClearSession()` | 退出登录，清除 token + 删除本地会话文件 |

### OCR 截图
| 方法 | 说明 |
|------|------|
| `SelectScreenshotFile()` | 弹出文件选择框（png/jpg/jpeg/webp）|
| `UploadScreenshot(filePath)` | 文件路径方式上传 OCR |
| `UploadScreenshotBase64(b64)` | base64 方式上传（支持剪贴板粘贴）|

### 附件上传
| 方法 | 说明 |
|------|------|
| `SelectAttachmentFile()` | 弹出文件选择框 |
| `UploadAttachmentBase64(b64)` | base64 方式上传备注图 |
| `UploadAttachmentFile(filePath)` | 文件路径方式上传备注图 |

### 订单
| 方法 | 说明 |
|------|------|
| `GetFollowStaffList()` | 获取在线跟单客服列表 |
| `SubmitOrder(orderSN, contact, staffUID, price, attachURLs, screenshotPath)` | 提交订单（409=重复）|

### 其他
| 方法 | 说明 |
|------|------|
| `GetMachineID()` / `GetMacAddress()` / `GetPlatform()` | 设备信息 |
| `GetServerURL()` / `SetServerURL(url)` | 服务端地址配置 |
| `CheckUpdate(currentVersion)` | OTA 版本检查 |

## 关键数据结构
```go
LoginResult     { Success, Message, Name, WecomUID }
OCRResult       { OrderSN, Price(分), RawPrice, OrderTime, Confidence, ScreenshotURL, Error }
FollowStaffItem { ID, Name, WecomUserID, Status, IsOnline, ActiveOrders }
SubmitResult    { Success, Message, OrderSN }
UploadAttachmentResult { URL, Error }
AppUpdateInfo   { Version, ForceUpdate, DownloadURL, ReleaseNotes, HasUpdate }
```

## 设备认证机制
- 设备指纹: macOS 读 IOPlatformUUID，Windows 读注册表 MachineGuid，SHA256 哈希
- 会话文件: `~/.pdd-session.json`，AES-256-GCM 加密（密钥由设备指纹派生），不可跨设备复制
- Token 续期: 本地解析 JWT exp，提前 5 分钟自动调用 device_login 静默刷新

## 服务端 API
所有请求发往 `https://zhiyuanshijue.ltd`，JWT Bearer 认证
- `POST /api/v1/auth/device_login` — 登录
- `POST /api/v1/orders/upload_ocr` — OCR（multipart）
- `POST /api/v1/orders/upload_attachment` — 附件（multipart）
- `GET /api/v1/orders/follow-staff` — 跟单客服列表
- `POST /api/v1/orders/create` — 提交订单
- `GET /api/v1/app/version` — 版本检查
