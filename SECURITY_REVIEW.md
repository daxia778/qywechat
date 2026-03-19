# PDD 派单管理系统 — 安全与代码质量审查报告

**审查日期**: 2026-03-19
**审查范围**: `server/handlers/`, `server/middleware/`, `server/main.go`, `server/config/config.go`, `server/models/db.go`, `server/services/order.go`
**审查员**: Code Reviewer (Automated)

---

## 安全等级评估: B+

系统整体安全意识较强，已实施多层防护（JWT + CSRF + 限速 + 暴力破解防护 + 安全响应头 + 可疑请求拦截 + CSV 注入防护）。主要风险集中在少数中等严重度问题上，无 Critical 级漏洞。

---

## 问题清单

### HIGH 严重度

#### H-1. JWT 缺少 `iat` (Issued At) 和 `jti` (JWT ID) 声明，无法实现 Token 撤销

- **文件**: `/Users/admin/Desktop/企微需求对接/server/middleware/auth.go:56-61`
- **描述**: `CreateToken` 生成的 JWT 仅包含 `sub`, `name`, `role`, `exp`。缺少 `iat` 导致无法判断 token 签发时间（例如密码修改后旧 token 仍有效）；缺少 `jti` 导致无法实现黑名单/撤销机制。当管理员禁用员工 (`ToggleEmployee`) 或解绑设备 (`UnbindDevice`) 后，该员工已签发的 JWT 在过期前仍然完全有效。
- **影响**: 员工被禁用后，在 token 过期前（默认 1440 分钟 = 24 小时）仍可访问所有已授权接口。
- **修复建议**:
  1. 在 JWT claims 中添加 `iat` 字段。
  2. 在 `Employee` 模型中添加 `token_revoked_at` 字段，禁用/解绑时更新此字段。
  3. `JWTAuth` 中间件中查询该字段，若 `iat < token_revoked_at` 则拒绝。

#### H-2. WebSocket 端点缺少速率限制

- **文件**: `/Users/admin/Desktop/企微需求对接/server/main.go:135`
- **文件**: `/Users/admin/Desktop/企微需求对接/server/handlers/ws.go:38-71`
- **描述**: `/api/v1/ws` 虽然在 `v1` 路由组下有 `APIRateLimit()`，但 WebSocket 升级本质上是单次 HTTP 请求后建立长连接。攻击者可在限速范围内建立大量 WebSocket 连接，耗尽服务器资源。
- **影响**: 资源耗尽型 DoS。
- **修复建议**:
  1. 在 `WebSocketHandler` 中限制每个用户（`userID`）的并发连接数（如最多 3 个）。
  2. 在 `services.Hub.Register` 中实现连接数上限检查。

#### H-3. 订单列表接口 (`ListOrders`) 缺少角色权限过滤

- **文件**: `/Users/admin/Desktop/企微需求对接/server/handlers/order_handler.go:284-332`
- **描述**: `ListOrders` 接口虽然在 JWT 保护下，但任何已登录用户（operator/designer）都能通过此接口查询所有订单，包括不属于自己的订单。对比 `GetOrder`（第 335-374 行）有严格的角色权限校验，`ListOrders` 完全缺失此逻辑。
- **影响**: 信息泄露 — 客服可查看其他客服的订单和客户信息，设计师可看到所有订单细节。
- **修复建议**: 在 `ListOrders` 中根据角色自动限定查询范围：
  - `operator`: 自动添加 `WHERE operator_id = ?`
  - `designer`: 自动添加 `WHERE designer_id = ?`
  - `admin`: 无限制

#### H-4. `GetOrderDetail` 和 `GetOrderTimeline` 缺少权限校验

- **文件**: `/Users/admin/Desktop/企微需求对接/server/handlers/ws.go:74-172`
- **描述**: `GetOrderDetail`（第 74-136 行）和 `GetOrderTimeline`（第 139-172 行）两个接口均未实现角色权限校验。任何已登录用户只要知道订单 ID，就可查看任意订单的详情、时间线和分润数据。对比同文件中 `GetOrder` 有完整的角色校验。
- **影响**: 敏感财务数据（分润明细）和操作时间线泄露。
- **修复建议**: 复用 `GetOrder` 中的角色权限校验逻辑，或抽取为公共函数 `checkOrderAccess(c, order)`。

---

### MEDIUM 严重度

#### M-1. CSRF 豁免范围过宽 — `upload_ocr` 和 `orders/create` 被跳过

- **文件**: `/Users/admin/Desktop/企微需求对接/server/middleware/csrf.go:52-61`
- **描述**: CSRF 中间件对 `/api/v1/orders/upload_ocr` 和 `/api/v1/orders/create` 做了豁免。这两个接口都是 POST 状态变更操作，且位于 JWT 保护下。如果用户在浏览器中使用系统（管理端），攻击者可构造恶意页面让已登录管理员的浏览器自动发起这两个请求。
- **影响**: 攻击者可在受害者不知情的情况下上传文件或创建订单。
- **修复建议**: 移除这两个路径的 CSRF 豁免。桌面客户端作为非浏览器应用，其请求不会携带 cookie，因此不受 CSRF 影响 — 应通过判断请求来源（如自定义 header）而非直接跳过 CSRF。

#### M-2. CSRF Token 存储在内存中，多实例部署时失效

- **文件**: `/Users/admin/Desktop/企微需求对接/server/middleware/csrf.go:14-19`
- **描述**: CSRF token 使用 `sync.RWMutex` + `map` 存储在进程内存中。如果使用负载均衡部署多实例，用户从实例 A 获取的 CSRF token 在实例 B 上无效。
- **影响**: 多实例部署时 CSRF 功能完全失效。
- **修复建议**: 当前单实例 SQLite 部署无此问题，但若未来迁移到 Postgres 多实例部署，需将 CSRF token 迁移到 Redis 或数据库。在当前阶段标记为 Medium 供未来参考。

#### M-3. 暴力破解防护基于 IP，无用户维度锁定

- **文件**: `/Users/admin/Desktop/企微需求对接/server/middleware/security.go:14-98`
- **描述**: `BruteForceGuard` 仅基于 IP 维度进行封锁。在 NAT 或企业网络场景下，共享同一出口 IP 的所有用户会因一个攻击者的行为被集体封锁。反之，使用代理池的攻击者可轻易绕过。
- **影响**: 合法用户误封（NAT 场景下）或防护被绕过（代理池场景下）。
- **修复建议**: 增加用户名/设备维度的失败计数。同时对相同用户名连续失败 N 次后临时锁定该账户（而非仅锁定 IP）。

#### M-4. `ListOrders` 的 keyword 搜索存在潜在的 LIKE 注入

- **文件**: `/Users/admin/Desktop/企微需求对接/server/handlers/order_handler.go:304-306`
- **描述**: `keyword` 直接拼入 LIKE 模式 `"%" + keyword + "%"`。虽然 GORM 使用参数化查询不存在 SQL 注入，但用户可输入 `%` 或 `_` 等 LIKE 通配符来操纵搜索结果，例如输入 `%` 匹配所有记录。
- **影响**: 低风险，但可能导致性能问题（全表扫描）或绕过搜索预期。
- **修复建议**: 对 keyword 中的 `%` 和 `_` 进行转义：`strings.NewReplacer("%", "\\%", "_", "\\_").Replace(keyword)`。

#### M-5. `NoRoute` 兜底返回 `index.html` 无内容类型校验

- **文件**: `/Users/admin/Desktop/企微需求对接/server/main.go:189-191`
- **描述**: `NoRoute` 对所有未匹配路由返回 `index.html`。虽然这是 SPA 的标准做法，但结合 `SuspiciousRequestFilter` 可能存在绕过 — 攻击者可能利用不在黑名单中的路径探测系统。同时，此行为导致任何 404 请求都返回 200 + HTML，可能对安全扫描器和爬虫产生误导。
- **影响**: 低风险，但增加了信息泄露面。
- **修复建议**: 对 `/api/` 前缀的未匹配路由返回标准 404 JSON 而非 index.html。

#### M-6. `CreateAppVersion` 缺少 `download_url` 校验

- **文件**: `/Users/admin/Desktop/企微需求对接/server/handlers/version_handler.go:34-46`
- **描述**: `CreateAppVersion` 接受管理员指定的 `download_url`，仅校验非空但不校验 URL 格式或域名。恶意管理员（或被盗管理员 token）可以设置指向恶意可执行文件的下载链接。
- **影响**: 供应链攻击 — 所有客户端 OTA 更新可能被重定向到恶意下载。
- **修复建议**: 校验 `download_url` 格式为合法 URL，且域名在白名单内。

#### M-7. 企微回调降级模式直接返回 `echostr`

- **文件**: `/Users/admin/Desktop/企微需求对接/server/handlers/wecom_handler.go:51-53`
- **描述**: 当 WecomToken/EncodingAESKey/CorpID 未配置时，回调验证直接返回 `echostr` 参数值。攻击者可利用此端点将任意字符串从服务器反射回来。
- **影响**: 低风险的反射攻击向量（XSS 需结合 Content-Type 操控，而此处返回 text/plain）。
- **修复建议**: 未配置完全时应直接返回 403 或固定字符串，而非回显用户输入。

---

### LOW 严重度

#### L-1. 默认 JWT Secret 明文出现在源码中

- **文件**: `/Users/admin/Desktop/企微需求对接/server/config/config.go:88`
- **描述**: `JWT_SECRET_KEY` 的默认值 `"dev-secret-change-in-prod"` 硬编码在源码中。虽然已有生产环境启动校验（第 110-114 行），但默认值泄露仍增加了 debug 模式下的风险。
- **影响**: 若开发环境对外暴露，攻击者可直接伪造任意 JWT。
- **修复建议**: 当前的校验逻辑已足够严格（生产环境 fatal），但建议默认值改为随机生成（如 `uuid.New().String()`），消除任何可预测性。

#### L-2. 默认管理员密码 `Admin123!` 硬编码

- **文件**: `/Users/admin/Desktop/企微需求对接/server/config/config.go:120`
- **描述**: debug 模式下 `ADMIN_DEFAULT_PASSWORD` 未设置时使用 `"Admin123!"`。此密码在 CLAUDE.md 中也以 `admin888` 形式出现。
- **影响**: 若 debug 模式对外暴露，攻击者可使用默认密码登录。
- **修复建议**: 保持现有逻辑即可，但建议即使在 debug 模式也生成随机密码并仅在控制台打印一次。

#### L-3. 错误响应中包含 `err.Error()` 信息

- **文件**: 多个 handler 文件
  - `/Users/admin/Desktop/企微需求对接/server/handlers/order_handler.go:29` — `"参数错误: " + err.Error()`
  - `/Users/admin/Desktop/企微需求对接/server/handlers/order_handler.go:111` — `err.Error()`
  - `/Users/admin/Desktop/企微需求对接/server/handlers/version_handler.go:37`
- **描述**: 部分 handler 将 Go 内部错误信息直接返回给客户端。在 debug 模式下可接受，但生产环境中可能泄露数据库结构、文件路径等内部信息。
- **影响**: 信息泄露，帮助攻击者了解系统内部结构。
- **修复建议**: 生产环境下对 `err.Error()` 进行脱敏，仅返回通用的用户友好错误信息，内部错误写日志而非返回给客户端。

#### L-4. `wxbizmsgcrypt.go` 使用 `math/rand` 而非 `crypto/rand`

- **文件**: `/Users/admin/Desktop/企微需求对接/server/middleware/wxbizmsgcrypt.go:116-122`
- **描述**: `randString` 方法使用 `math/rand.Int63()` 生成加密填充字符串。`math/rand` 是伪随机数生成器，输出可预测。
- **影响**: 低风险 — 此随机字符串用于 AES-CBC 消息加密的填充部分，虽然理论上减弱了加密强度，但主要安全保障来自 AES 密钥本身。
- **修复建议**: 替换为 `crypto/rand`。

#### L-5. `pKCS7Unpadding` 缺少 padding 值范围校验

- **文件**: `/Users/admin/Desktop/企微需求对接/server/middleware/wxbizmsgcrypt.go:133-143`
- **描述**: `padding_len` 直接从最后一个字节读取（第 141 行），但未校验 `padding_len` 是否在 `[1, block_size]` 范围内。恶意输入可能导致 `plaintext_len - padding_len` 为负值或越界。
- **影响**: Go slice 索引越界会 panic，造成服务中断（但仅影响企微回调解密路径）。
- **修复建议**: 添加 `if padding_len < 1 || padding_len > block_size { return error }` 校验。

#### L-6. 限速器的内存清理间隔可能导致短暂内存膨胀

- **文件**: `/Users/admin/Desktop/企微需求对接/server/middleware/ratelimit.go:34-46`
- **描述**: 每个 `RateLimitByIP` 调用都会创建一个独立的限流器存储，各自启动后台清理 goroutine。在大量不同 IP 的高并发场景下，3 分钟的清理间隔可能导致每个存储积累大量条目。
- **影响**: 极端场景下内存使用增加，但 5 分钟过期策略使其有上限。
- **修复建议**: 当前实现对预期流量规模（日单量 60-100）已经足够。无需立即修复。

---

## 正面发现（安全亮点）

以下安全措施实现良好，值得肯定：

1. **SQL 注入防护**: 所有数据库查询一致使用 GORM 参数化查询，未发现原始字符串拼接。即使 `ListOrders` 的 keyword LIKE 查询也使用了 `?` 占位符。
2. **抢单并发安全**: `GrabOrder` 使用 `UPDATE ... WHERE status = 'PENDING'` 原子操作 + `WriteTx` 串行化写锁，有效防止并发抢单冲突。
3. **JWT Algorithm Confusion 防护**: `JWTAuth`（auth.go:28-30）和 `WebSocketHandler`（ws.go:47-49）都严格校验签名算法必须为 HMAC，防止 `alg: none` 或 RSA 混淆攻击。
4. **bcrypt 密码存储**: 所有密码和激活码都使用 bcrypt 哈希存储，未发现明文存储。
5. **CSV Formula Injection 防护**: `sanitizeCSVCell` 函数正确处理了 `=`, `+`, `-`, `@`, `\t`, `\r` 开头的危险前缀。
6. **安全响应头完整**: SecurityHeaders 覆盖了 X-Content-Type-Options, X-Frame-Options, HSTS, CSP, Referrer-Policy, Permissions-Policy。
7. **请求体大小限制**: 双重限制 — 全局 2MB MaxBodySize + 文件上传 10MB MaxMultipartMemory。
8. **CSRF Token 一次性使用**: Token 验证后立即删除（csrf.go:91），防止重放攻击。原子化 check-and-delete 防止 TOCTOU 竞态。
9. **属主权限校验**: `GrabOrder` 校验 JWT 中的 `wecom_userid` 匹配请求中的 `designer_userid`，防止代替他人抢单。`UpdateOrderStatus` 中 operator/designer 只能操作自己的订单。
10. **生产环境安全检查**: config.go 中对弱 JWT Secret 和空管理员密码在非 debug 模式下 `log.Fatal` 阻止启动。
11. **审计日志**: 登录成功/失败、员工操作等关键事件均有 AuditLog 记录。

---

## 优先修复建议

按修复优先级排序：

| 优先级 | 编号 | 问题 | 预估工作量 |
|--------|------|------|-----------|
| P0 | H-3 | ListOrders 缺少角色权限过滤 | 0.5h |
| P0 | H-4 | GetOrderDetail/GetOrderTimeline 缺权限校验 | 0.5h |
| P1 | H-1 | JWT 无法撤销（禁用员工 token 仍有效） | 2h |
| P1 | M-1 | CSRF 豁免过宽 | 0.5h |
| P2 | H-2 | WebSocket 连接数无上限 | 1h |
| P2 | M-6 | CreateAppVersion download_url 未校验 | 0.5h |
| P2 | M-7 | 企微回调降级直接回显用户输入 | 0.5h |
| P3 | M-3 | 暴力破解防护仅基于 IP | 2h |
| P3 | M-4 | LIKE 通配符未转义 | 0.5h |
| P3 | L-3 | 错误响应泄露内部信息 | 1h |
| P4 | L-4 | wxbizmsgcrypt 使用 math/rand | 0.5h |
| P4 | L-5 | PKCS7 Unpadding 缺范围校验 | 0.5h |

**建议立即修复 P0 级别的两个权限绕过问题（H-3 和 H-4），这是当前最大的安全风险点。**

---

## 总结

PDD 派单管理系统在安全方面已经做了大量工作，防护体系相对完整。最严重的问题集中在 **接口级别的权限校验不一致** — 部分接口（如 `GetOrder`）有严格的角色权限检查，但同类接口（如 `ListOrders`, `GetOrderDetail`, `GetOrderTimeline`）遗漏了此逻辑。这是典型的"安全覆盖不完整"问题，修复成本低但影响大，建议优先处理。

JWT token 撤销机制是另一个值得关注的点，尤其是在员工管理（禁用/解绑）场景下，确保 token 即时失效对系统安全至关重要。
