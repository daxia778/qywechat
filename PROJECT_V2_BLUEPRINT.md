# PDD 派单管理系统 — V2 完整蓝图

**版本**: v2.2
**更新日期**: 2026-04-28
**项目路径**: `/Users/admin/Desktop/企微需求对接`
**GitHub**: [daxia778/qywechat](https://github.com/daxia778/qywechat)
**访问地址**: `http://localhost:8200`

---

## 一、项目定位

面向 PPT 定制服务团队的**全流程自动化工单平台**。

| 维度 | 数据 |
|:---|:---|
| 团队规模 | 10-20 人（兼职客服 + 设计师） |
| 日单量 | 60-100 单 |
| 日营业额 | ~¥3000 |
| 核心渠道 | 拼多多（获客+首次收款）+ 企业微信（私域服务+追加收款） |
| 技术栈 | Go 1.24 + Gin + GORM + SQLite / React 19 + Vite 6 + TailwindCSS v4 / Wails v2 + Vue 3 |
| 端口 | 前端 8200 / 后端 8201 |

---

## 二、四角色体系

### 2.1 角色定义

| 角色 | 系统标识 | 核心职责 | 操作范围 |
|:---|:---|:---|:---|
| **跟单客服** | `follow` | 拼多多接单录入、企微群内安抚客户、售后标记、退款记录 | 自己经手的订单 |
| **谈单客服** | `sales` | 确认需求细节（PPT风格、交期、企业VI）、解答客户疑虑 | 自己参与的订单 |
| **设计师** | `designer` | PPT制作与交付、客户修改、金额/页数调整 | 自己接手的订单 |
| **管理员** | `admin` | 全局数据、分润统计、员工管理、报表导出、系统配置 | 全部 |

> **后续规划**: 谈单客服角色将逐步由 AI 助手替代（基于大语言模型），因其话术相对固定和标准化，可实现更高程度的自动化。

### 2.2 角色在订单中的关系

```
一个订单关联：
├── 1 个跟单客服（follow）  — 录单人，全程跟踪
├── 1 个谈单客服（sales）   — 需求确认人（后续可由AI替代）
├── 1 个设计师（designer）  — 制作交付人
└── 客户（external_contact）— 通过企微群沟通
```

### 2.3 统一登录 + 角色路由

所有角色共用同一登录入口 `/auth/login`，系统根据账号角色自动展示不同菜单和权限：

| 页面/功能 | admin | follow | sales | designer |
|:---|:---:|:---:|:---:|:---:|
| 仪表盘（看板） | ✅ | ✅ | ✅ | ✅ |
| 订单管理 | ✅ 全部 | ✅ 自己的 | ✅ 自己的 | ✅ 自己的 |
| 订单操作（状态流转） | ✅ | ✅ 录单/售后 | ✅ 确认需求 | ✅ 交付/修改 |
| 顾客管理 | ✅ | ✅ | ✅ | ❌ |
| 团队负载 | ✅ | ❌ | ❌ | ❌ |
| 员工管理 | ✅ | ❌ | ❌ | ❌ |
| 营收图表 | ✅ | ❌ | ❌ | ❌ |
| 数据导出 | ✅ | ❌ | ❌ | ❌ |
| 收款流水 | ✅ | ✅ 只看 | ❌ | ❌ |

---

## 三、完整业务流程

### 3.1 主流程

```
┌─────────────────────────────────────────────────────────────────┐
│  阶段一：获客与录单（拼多多）                                      │
│                                                                 │
│  1. 客户在拼多多下单付款                                          │
│  2. 客户发送个人微信二维码/联系方式给客服                           │
│  3. 跟单客服截图 → 桌面端OCR识别（订单号、金额、页数、联系方式等）    │
│  4. 跟单客服提交工单 → 系统创建订单（状态: PENDING）                │
│  5. 系统记录第一笔收款流水（来源: 拼多多）                          │
├─────────────────────────────────────────────────────────────────┤
│  阶段二：加好友与建群（企业微信）                                   │
│                                                                 │
│  6. 跟单客服用客户留的微信号/手机号，手动在企微搜索添加客户好友       │
│  7. 客户通过好友请求 → 企微回调通知系统（add_external_contact）      │
│  8. 系统弹出匹配界面 → 客服点选关联对应订单                        │
│  9. 系统写入 external_userid → 关联顾客档案                       │
│ 10. 系统自动选择空闲设计师（负载均衡算法）                          │
│ 11. 系统自动创建客户群（客户 + 跟单 + 谈单 + 设计师 + 老板）        │
│ 12. 群内自动发送需求播报（订单信息 + 客户需求 + 交付截止时间）       │
│     订单状态 → GROUP_CREATED                                     │
├─────────────────────────────────────────────────────────────────┤
│  阶段三：需求确认（谈单客服 / 未来AI助手）                          │
│                                                                 │
│ 13. 谈单客服在群内与客户沟通细节（风格、交期、企业信息等）           │
│ 14. 需求确认完毕 → 前端操作确认 → 订单状态 → CONFIRMED             │
├─────────────────────────────────────────────────────────────────┤
│  阶段四：设计制作                                                 │
│                                                                 │
│ 15. 设计师在前端界面接手订单 → 订单状态 → DESIGNING                │
│ 16. 制作过程中客户可能追加需求（加页等）                            │
│     → 企微对外收款（第二笔流水）                                   │
│     → 设计师在前端修改订单金额/页数                                │
│     → 系统自动重算分润                                            │
│ 17. 设计师交付 → 前端操作 → 订单状态 → DELIVERED                   │
├─────────────────────────────────────────────────────────────────┤
│  阶段五：客户确认与完结                                           │
│                                                                 │
│ 18. 客户确认满意 → 跟单客服前端操作 → 订单状态 → COMPLETED          │
│ 19. 客户需修改 → 订单状态 → REVISION → 设计师修改 → 重回交付       │
├─────────────────────────────────────────────────────────────────┤
│  售后（可能在任何阶段发生）                                        │
│                                                                 │
│  · 加页/改需求 → 修改金额 + 企微追加收款                           │
│  · 退款 → 客户在拼多多发起 → 跟单客服在系统标记退款                 │
│  · 纠纷 → 跟单客服标记售后状态 + 备注原因                          │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 订单状态机

```
                    ┌──────────┐
                    │ PENDING  │  跟单客服录单创建
                    └────┬─────┘
                         │ 客服关联好友 + 系统自动建群
                    ┌────▼─────────┐
                    │GROUP_CREATED │  企微群已建立
                    └────┬─────────┘
                         │ 谈单客服确认需求
                    ┌────▼─────┐
                    │CONFIRMED │  需求已确认（新增状态）
                    └────┬─────┘
                         │ 设计师接手
                    ┌────▼─────┐
              ┌────▶│DESIGNING │  设计制作中
              │     └────┬─────┘
              │          │ 设计师交付
              │     ┌────▼─────┐
              │     │DELIVERED │  已交付待确认
              │     └────┬─────┘
              │          │
              │     ┌────▼─────┐     ┌─────────┐
              │     │客户反馈？ │────▶│COMPLETED│  客户确认完成
              │     └────┬─────┘     └─────────┘
              │          │ 需修改
              │     ┌────▼─────┐
              └─────│REVISION  │  修改中（新增状态）
                    └──────────┘

  旁路状态（任何阶段均可触发）：
  ┌──────────┐
  │REFUNDED  │  客户在拼多多发起退款
  └──────────┘
  ┌──────────┐
  │AFTER_SALE│  售后处理中（新增状态）
  └──────────┘
  ┌──────────┐
  │ CLOSED   │  管理员手动关闭
  └──────────┘
```

**新增状态说明：**

| 状态 | 说明 | 触发角色 |
|:---|:---|:---|
| `CONFIRMED` | 谈单客服已确认需求，等待设计师接手 | sales |
| `REVISION` | 客户要求修改，设计师重新制作 | follow/admin |
| `AFTER_SALE` | 售后处理中（加页、改需求、纠纷等） | follow/admin |

**合法状态转换表：**

| 当前状态 | 可转换到 | 操作角色 |
|:---|:---|:---|
| PENDING | GROUP_CREATED, CLOSED, REFUNDED | follow, admin |
| GROUP_CREATED | CONFIRMED, CLOSED, REFUNDED | sales, admin |
| CONFIRMED | DESIGNING, CLOSED, REFUNDED | designer, admin |
| DESIGNING | DELIVERED, AFTER_SALE, CLOSED, REFUNDED | designer, follow, admin |
| DELIVERED | COMPLETED, REVISION, AFTER_SALE, REFUNDED | follow, admin |
| REVISION | DESIGNING, AFTER_SALE, CLOSED, REFUNDED | designer, follow, admin |
| AFTER_SALE | DESIGNING, REVISION, COMPLETED, REFUNDED, CLOSED | follow, admin |
| COMPLETED | AFTER_SALE, REFUNDED | follow, admin |
| REFUNDED | — （终态） | — |
| CLOSED | — （终态） | — |

---

## 四、双流水线收款模型

### 4.1 两条收款渠道

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│     拼多多收款（首次）        │     │     企微对外收款（追加）      │
├─────────────────────────────┤     ├─────────────────────────────┤
│ 来源: 拼多多平台交易          │     │ 来源: 企微对外收款功能        │
│ 时机: 客户下单时              │     │ 时机: 制作过程中加页/改需求   │
│ 录入: OCR识别 + 手动填写      │     │ 获取: API定时拉取（每2小时）  │
│ 金额: 锁定在订单初始金额      │     │ 关联: external_userid匹配    │
│ 频率: 每单1笔                │     │ 频率: 每单0~N笔             │
└─────────────────────────────┘     └─────────────────────────────┘
                  │                                │
                  └──────────┬─────────────────────┘
                             ▼
                   ┌─────────────────┐
                   │  订单总收入汇总   │
                   │ = 拼多多 + 企微   │
                   └────────┬────────┘
                            ▼
                   ┌─────────────────┐
                   │   分润实时计算    │
                   │ 基于最终总金额    │
                   └─────────────────┘
```

### 4.2 企微对外收款 API

**接口**: `POST /cgi-bin/externalpay/get_bill_list`

**请求参数**:

| 参数 | 必须 | 说明 |
|:---|:---:|:---|
| `access_token` | 是 | 收款应用的凭证 |
| `begin_time` | 是 | 开始时间（Unix时间戳） |
| `end_time` | 是 | 结束时间（Unix时间戳） |
| `payee_userid` | 否 | 收款方员工userid |
| `cursor` | 否 | 分页游标 |
| `limit` | 否 | 最大记录数（默认/最大1000） |

**返回关键字段**:

| 字段 | 说明 | 与系统的关联 |
|:---|:---|:---|
| `transaction_id` | 交易单号 | 收款流水唯一标识 |
| `external_userid` | 付款客户ID | **关联到顾客档案（Customer.ExternalUserID）** |
| `total_fee` | 金额（分） | 追加到订单总金额 |
| `pay_time` | 支付时间 | 流水时间 |
| `payee_userid` | 收款员工ID | 记录经手人 |
| `remark` | 备注 | 辅助匹配订单 |
| `trade_state` | 交易状态 | 筛选有效流水 |

**限制**: 时间跨度不超过31天，需定期拉取。

**同步策略**: 每2小时拉取一次，系统自动通过 `external_userid` 关联到顾客，再关联到对应订单。

### 4.3 收款流水数据模型（新增）

```go
// PaymentRecord — 收款流水记录
type PaymentRecord struct {
    ID              uint           `gorm:"primaryKey"`
    TransactionID   string         `gorm:"size:64;uniqueIndex"`  // 交易单号（企微/手动录入）
    OrderID         uint           `gorm:"index"`                // 关联订单
    CustomerID      uint           `gorm:"index"`                // 关联顾客
    ExternalUserID  string         `gorm:"size:64;index"`        // 企微外部联系人ID
    Amount          int            //                             // 金额（分）
    Source          string         `gorm:"size:20"`              // pdd / wecom / manual
    PayeeUserID     string         `gorm:"size:64"`              // 收款员工ID
    Remark          string         `gorm:"size:256"`             // 备注
    TradeState      string         `gorm:"size:20"`              // 交易状态
    PaidAt          time.Time      //                             // 支付时间
    MatchedAt       *time.Time     //                             // 系统匹配时间
    MatchMethod     string         `gorm:"size:20"`              // auto / manual
    CreatedAt       time.Time
}
```

### 4.4 分润计算模型

```
订单总金额 = 拼多多首次收款 + 企微追加收款（可多笔）

分润四方：
├── 平台手续费   = 总金额 × PLATFORM_FEE_RATE（默认5%）
├── 设计师佣金   = 总金额 × DESIGNER_COMMISSION_RATE（默认15%）
├── 谈单客服佣金 = 总金额 × SALES_COMMISSION_RATE（默认10%）
├── 跟单客服佣金 = 总金额 × FOLLOW_COMMISSION_RATE（默认5%）
└── 净利润       = 总金额 - 以上四项

注意：
· 金额/页数修改后，分润实时重算
· 退款订单不计入分润
· 最终结算以订单 COMPLETED 时的总金额为准
```

---

## 五、企微集成能力清单

### 5.1 已实现的能力

| 能力 | API | 代码位置 | 状态 |
|:---|:---|:---|:---:|
| access_token 管理（主应用+客户联系） | `/gettoken` | `services/wecom.go` | ✅ |
| 文本消息推送 | `/message/send` | `services/wecom.go` | ✅ |
| 卡片消息推送 | `/message/send` (textcard) | `services/wecom.go` | ✅ |
| 内部群聊创建 | `/appchat/create` | `services/wecom.go` | ⚠️ 需改造 |
| 群内发消息 | `/appchat/send` | `services/wecom.go` | ⚠️ 需改造 |
| 通讯录同步（每小时） | `/user/list` | `services/wecom_sync.go` | ✅ |
| 回调验证 + AES加解密 | callback URL验证 | `handlers/wecom_handler.go` | ✅ |
| 外部联系人添加回调 | `change_external_contact` | `handlers/wecom_handler.go` | ✅ |
| 群消息关键词触发（已交付） | 文本消息回调 | `handlers/wecom_handler.go` | ✅ |
| 「联系我」二维码创建 | `/externalcontact/add_contact_way` | `services/wecom.go` | ✅ |
| 获取外部联系人列表 | `/externalcontact/list` | `services/wecom.go` | ✅ |
| 获取外部联系人详情 | `/externalcontact/get` | `services/wecom.go` | ✅ |
| 企微数据90天清理 | 定时任务 | `services/wecom_sync.go` | ✅ |
| 企微连通性诊断 | 自定义接口 | `handlers/wecom_handler.go` | ✅ |

### 5.2 需要新增/改造的能力

| 能力 | API | 优先级 | 说明 |
|:---|:---|:---:|:---|
| **客户群创建** | `/externalcontact/groupchat/create` | **P0** | 替代现有内部群，支持拉入外部联系人（客户） |
| **对外收款记录拉取** | `/externalpay/get_bill_list` | **P0** | 每2小时同步，关联订单和顾客 |
| **发送欢迎语** | `/externalcontact/send_welcome_msg` | P1 | 客户加好友后自动发欢迎消息 |
| **客户备注更新** | `/externalcontact/remark` | P1 | 自动给客户备注订单号 |
| **回调入站消息日志** | 消息回调 direction=in | P1 | 记录客户在群内的消息 |
| **外部联系人删除回调** | `del_external_contact` | P2 | 客户删除员工时的处理 |

### 5.3 企微API关键限制

| 限制 | 影响 | 应对方案 |
|:---|:---|:---|
| **无法主动添加外部好友** | 不能通过API自动加客户微信 | 客服手动添加 + 系统辅助匹配 |
| **外部联系人详情不含手机号/微信号** | 无法自动匹配联系方式 | 客服手动关联订单（一键点选） |
| **对外收款时间跨度≤31天** | 不能一次拉全量历史 | 每2小时增量拉取 + 定期补偿 |
| **内部群聊(appchat)不能加外部联系人** | 现有建群方案客户进不去 | **必须改造为客户群方案** |
| **欢迎语code有效期约20秒** | 必须在回调中立即使用 | 异步+重试机制 |

---

## 六、顾客管理体系

### 6.1 顾客档案模型（改造）

```go
type Customer struct {
    ID              uint
    // 身份标识（多来源，需合并）
    WechatID        string         // 微信号（录单时填写）
    Mobile          string         // 手机号（录单时填写）
    ExternalUserID  string         // 企微外部联系人ID（加好友回调写入）
    Nickname        string         // 昵称（企微API获取）

    // 统计字段
    TotalOrders     int            // 累计下单数
    TotalAmount     int            // 累计消费金额（分）— 含拼多多+企微收款
    TotalPayments   int            // 累计收款笔数
    FirstOrderAt    *time.Time
    LastOrderAt     *time.Time

    // 标签
    IsRepurchase    bool           // 复购客户（TotalOrders > 1）
    Tags            string         // 标签（逗号分隔：vip,售后,大单等）
    Source          string         // 来源渠道（pdd/referral/other）

    Remark          string
    CreatedAt       time.Time
    UpdatedAt       time.Time
    DeletedAt       gorm.DeletedAt
}
```

### 6.2 顾客记录合并逻辑（关键改造）

**问题**: 当前录单创建的Customer（有mobile/wechat_id）和加好友回调创建的Customer（有external_user_id）是两条独立记录。

**解决方案**: 客服手动关联订单时，系统同步合并Customer记录。

```
加好友回调触发：
  1. 系统拿到 external_userid + 员工 userid
  2. 查询该员工有哪些"待匹配"订单（状态=PENDING，无external_userid）
  3. 弹出匹配界面 → 客服点选
  4. 合并逻辑：
     - 找到录单时创建的 Customer（有 mobile 或 wechat_id）
     - 将 external_userid 写入该记录
     - 如果回调方也创建了Customer，合并后删除重复记录
     - 更新 Order.CustomerID 确保指向合并后的记录
```

---

## 七、订单金额修改与分润重算

### 7.1 金额/页数修改机制

| 场景 | 操作人 | 影响 |
|:---|:---|:---|
| 客户加页 | 设计师修改订单页数+金额 | 分润重算 |
| 客户减页 | 设计师修改订单页数+金额 | 分润重算 |
| 客户改需求加价 | 设计师修改金额 | 分润重算 |
| 退款 | 跟单客服标记退款状态 | 不计入分润 |

### 7.2 修改记录审计

每次金额/页数修改都写入时间线：

```go
type TimelineEvent struct {
    OrderID     uint
    EventType   string   // amount_changed / pages_changed / status_changed / ...
    OldValue    string   // 修改前值
    NewValue    string   // 修改后值
    OperatorID  uint     // 操作人
    Remark      string   // 修改原因
    CreatedAt   time.Time
}
```

---

## 八、数据导出体系

### 8.1 导出维度

| 维度 | 内容 | 格式 | 操作角色 |
|:---|:---|:---:|:---:|
| **全量订单** | 指定时间段内所有订单明细 | Excel (.xlsx) | admin |
| **按员工-订单** | 某员工经手的订单列表 | Excel (.xlsx) | admin |
| **按员工-分润** | 某员工的分润明细（每单佣金） | Excel (.xlsx) | admin |
| **按角色汇总** | 所有设计师/客服的业绩对比 | Excel (.xlsx) | admin |
| **月结报表** | 月度自动汇总（营收+分润+排行） | Excel (.xlsx) | admin |
| **收款流水** | 拼多多+企微全部收款记录 | Excel (.xlsx) | admin |

### 8.2 Excel 报表结构（多Sheet）

```
Sheet 1: 汇总
  - 月度总营收（拼多多+企微）
  - 月度总订单数
  - 月度总退款
  - 四方分润汇总
  - 净利润

Sheet 2: 订单明细
  - 订单号、客户、金额、页数、状态
  - 跟单客服、谈单客服、设计师
  - 各方分润金额

Sheet 3: 员工业绩
  - 按员工分组统计
  - 订单量、经手金额、佣金收入

Sheet 4: 收款流水
  - 拼多多收款 + 企微收款合并
  - 来源、金额、时间、关联订单
```

### 8.3 技术方案

后端使用 `excelize` 库生成 `.xlsx` 文件，替代现有的 CSV 导出：
- 支持多Sheet
- 支持数字格式化（金额显示为 ¥X,XXX.XX）
- 支持条件格式（退款行标红等）

---

## 九、AI 谈单助手（远期规划）

### 9.1 背景

谈单客服的工作内容相对标准化：
- 确认PPT风格偏好
- 确认页数和交付时间
- 回答客户常见问题（价格、修改次数、加急等）
- 沟通企业VI规范

这些话术可以用大语言模型替代。

### 9.2 初步架构设想

```
客户在企微群发送消息
  → 系统回调接收消息
  → 判断是否为需求确认阶段的问题
  → 调用 LLM（基于订单上下文 + 话术知识库）
  → 生成回复 → 通过企微API发送到群内
  → 人工客服可随时接管（兜底）
```

### 9.3 实施前提

- 企微群改造为客户群方案（能接收群内消息）
- 积累足够的谈单话术样本作为知识库
- 设置人工接管机制（AI不确定时转人工）
- 先在少量订单上试运行，验证效果

> 此部分为远期规划，优先级 P4，在核心流程跑通后再推进。

---

## 十、现有代码问题与改造清单

### 10.1 必须改造项（阻塞核心流程）

| # | 问题 | 影响 | 改造方案 |
|:---:|:---|:---|:---|
| 1 | **建群用的是内部群(appchat)，客户无法加入** | 客户不在群里，企微群形同虚设 | 改用客户群 `/externalcontact/groupchat` |
| 2 | **Customer记录不合并** | 同一客户两条记录，数据割裂 | 加好友关联时自动合并 |
| 3 | **分润无完整计算函数** | 只有配置，没有落库的计算链路 | 新增 `CalculateProfit()` + 实时重算 |
| 4 | **订单金额不可修改** | 加页改需求后金额无法更新 | 新增修改接口 + 审计日志 |
| 5 | **缺少收款流水模型** | 企微收款数据无处存放 | 新增 PaymentRecord 模型 + 同步任务 |

### 10.2 安全与稳定性问题（P0）

| # | 问题 | 位置 | 影响 |
|:---:|:---|:---|:---|
| 1 | `grab_monitor.go` AssignedAt nil 指针 panic | services/grab_monitor.go:75-76 | 监控goroutine永久停止 |
| 2 | `GetGrabAlerts` 同样 nil 解引用 | services/grab_monitor.go:128 | API 500 |
| 3 | `/customers` 前端路由缺角色守卫 | router/index.jsx:125 | 顾客PII泄露给designer |
| 4 | `ListOrders` 缺角色权限过滤 | handlers/order_handler.go | 任何角色可查所有订单 |
| 5 | `GetOrderDetail/Timeline` 缺权限校验 | handlers/order_handler.go | 知道ID即可查任意订单 |
| 6 | 诊断接口暴露 corp_id/agent_id | handlers/wecom_handler.go:224 | 信息泄露 |

### 10.3 欢迎语未实现

`WelcomeCode` 已从回调XML中解析，但完全未使用。客户加好友后应自动发送欢迎消息。

---

## 十一、分期开发路线图

### Phase 4 — 核心流程闭环（1-2周）

**目标**: 打通 录单→加好友→匹配→建群→制作→交付→完成 全流程

| # | 任务 | 预估 | 依赖 |
|:---:|:---|:---:|:---|
| 1 | 建群方案从内部群改造为客户群 | 2d | 企微客户群API |
| 2 | 加好友回调 → 订单匹配界面（前端+后端） | 2d | — |
| 3 | Customer记录合并逻辑 | 1d | #2 |
| 4 | 订单状态机补充（CONFIRMED/REVISION/AFTER_SALE） | 1d | — |
| 5 | 订单金额/页数修改接口 + 时间线审计 | 1d | — |
| 6 | 分润计算引擎（实时重算 + 落库） | 1d | #5 |
| 7 | P0安全问题修复（6项） | 1d | — |
| 8 | 角色权限完善（follow/sales/designer前端菜单和操作） | 2d | #4 |

### Phase 5 — 收款与统计（1周）

**目标**: 双流水线数据闭环 + 导出增强

| # | 任务 | 预估 | 依赖 |
|:---:|:---|:---:|:---|
| 9 | PaymentRecord 模型 + API | 1d | — |
| 10 | 企微对外收款定时同步（每2小时） | 1d | #9 |
| 11 | 收款流水自动关联订单（external_userid匹配） | 1d | #9, #3 |
| 12 | 总营收统计改造（拼多多+企微合并） | 0.5d | #11 |
| 13 | Dashboard看板改造（新增收款流水、售后统计） | 1d | #12 |
| 14 | Excel导出替代CSV（excelize + 多Sheet） | 2d | #12 |
| 15 | 按员工/按角色导出 | 1d | #14 |

### Phase 6 — 体验优化（1周）✅ 已完成

**目标**: UI提升 + 稳定性

| # | 任务 | 预估 | 状态 |
|:---:|:---|:---:|:---:|
| 16 | 欢迎语自动发送 | 0.5d | ⏳ 待排期 |
| 17 | Design Token统一（全局品牌色板 Indigo/Slate、线条风格 SVG 图标） | 2h | ✅ 已完成 |
| 18 | 组件库落地（Dashboard/Orders/Revenue/Employees/RiskCenter） | 1d | ✅ 已完成 |
| 19 | 表格基础样式 + 响应式（colgroup百分比布局、tabular-nums对齐） | 1d | ✅ 已完成 |
| 20 | KPI骨架屏 + Loading优化 | 0.5d | ✅ 已完成 |
| 21 | N+1查询优化 + Dashboard SQL聚合 | 1d | ✅ 已完成 |
| 22 | WebSocket连接数上限 | 0.5d | ✅ 已完成 |
| 23 | 营收图表双柱状图 + ECharts DataZoom 区间选择器 | 0.5d | ✅ 已完成 |
| 24 | 自定义日期范围日历选择器（复用 DateFilterBar 模式） | 0.5d | ✅ 已完成 |
| 25 | 利润构成图表图例/间距优化 | 0.5h | ✅ 已完成 |
| 26 | 设计师排行表重构（百分比列宽、居中对齐、紧凑布局） | 0.5h | ✅ 已完成 |

### Phase 7 — AI谈单助手（远期，2-4周）

| # | 任务 | 预估 | 依赖 |
|:---:|:---|:---:|:---|
| 23 | 话术知识库构建 | 3d | — |
| 24 | LLM对接（通过本地代理） | 2d | — |
| 25 | 群消息接收 → AI回复 → 企微群发送 | 3d | Phase 4 #1 |
| 26 | 人工接管机制 | 1d | #25 |
| 27 | 试运行 + 调优 | 5d | #26 |

---

## 十二、技术架构参考

### 12.1 后端新增模块

```
server/
├── services/
│   ├── wecom_group.go      # 客户群管理（替代现有appchat方案）
│   ├── wecom_payment.go    # 企微对外收款同步
│   ├── profit.go           # 分润计算引擎
│   └── export.go           # Excel导出服务
├── handlers/
│   ├── payment_handler.go  # 收款流水API
│   └── export_handler.go   # 导出API（替代现有CSV）
└── models/
    └── payment.go          # PaymentRecord模型
```

### 12.2 前端新增页面/组件

```
admin-web/src/
├── pages/
│   ├── PaymentsPage.jsx        # 收款流水页面（新增）
│   └── OrderMatchPage.jsx      # 好友-订单匹配弹窗（新增）
├── components/
│   ├── OrderAmountEditor.jsx   # 金额/页数修改组件（新增）
│   ├── PaymentTimeline.jsx     # 收款流水时间线（新增）
│   └── ExportDialog.jsx        # 导出选项对话框（新增）
└── api/
    ├── payments.js             # 收款流水API（新增）
    └── export.js               # 导出API（新增）
```

### 12.3 定时任务

| 任务 | 频率 | 说明 |
|:---|:---|:---|
| 通讯录同步 | 每小时 | 已有 |
| 抢单超时监控 | 每30秒 | 已有 |
| 交付截止提醒 | 每5分钟 | 已有 |
| **企微收款同步** | 每2小时 | **新增** |
| SQLite每日备份 | 每天 | 已有 |
| 上传文件7天清理 | 每天 | 已有 |
| 企微数据90天清理 | 每天 | 已有 |

---

## 十三、文档索引

| 文档 | 路径 | 内容 |
|:---|:---|:---|
| **本文档（V2蓝图）** | `PROJECT_V2_BLUEPRINT.md` | 完整业务流程、技术方案、开发路线图 |
| V2改造总览 | `PDD派单系统_V2改造总览与后续规划.md`（桌面） | V2已完成内容和审查报告 |
| 项目指南 | `CLAUDE.md` | 开发环境配置和代码规范 |
| 架构审查 | `ARCHITECTURE_REVIEW.md` | 架构评分7.2/10 |
| 安全审查 | `SECURITY_REVIEW.md` | 安全等级B+ |
| 前端审查 | `FRONTEND_REVIEW.md` | 迁移完成度100% |
| UI审查 | `UI_REVIEW.md` | 设计质量7.2/10 |
| PRD差距分析 | `PRD_GAP_ANALYSIS.md` | MVP覆盖率85% |
| 代码审查 | `review-report.md` | 第三轮，30项待修 |
| 代码审计 | `CODE_AUDIT_2026-03-21.md` | 最新审计报告 |

---

*本文档基于项目源码分析、企微API文档调研、以及与项目负责人（柒）的多轮需求讨论综合编写。*
*初次生成: 2026-03-21 | 最近更新: 2026-04-28（Phase 6 标记完成）*
*生成工具: Claude Code (Opus 4.6)*
