# PDD 派单管理系统 -- 前端 UI 质量审查报告

**审查日期**: 2026-03-19
**审查角色**: 设计师视角审查员
**审查范围**: admin-web/src/ 全部页面与组件
**参考风格**: Brave 官网简约风 + uiverse.io 精致组件效果

---

## 一、UI 质量总评分: 7.2 / 10

| 维度 | 评分 | 说明 |
|------|------|------|
| 设计一致性 | 7.5 | 设计 Token 体系已建立，但页面间仍有大量内联硬编码打破一致性 |
| 视觉层次 | 7.0 | KPI 卡片与图表区分清晰，但信息密度大的表格页面层次偏平 |
| 交互体验 | 7.5 | Loading/空状态/错误状态均已覆盖，但 skeleton 占位未实际使用 |
| 响应式适配 | 6.5 | 基础断点有处理，但中等屏幕和表格溢出处理偏弱 |
| 微交互与动画 | 7.0 | 登录页动画品质高，但内页 hover/transition 缺少精致感 |
| 对标 Brave 风格 | 7.0 | 留白和排版接近，但缺少 Brave 标志性的渐变/光效/主题色运用 |
| 组件复用度 | 6.5 | 已有 ui/ 组件库雏形，但大多数页面未使用，直接内联样式 |

---

## 二、逐页面 / 组件评价

### 2.1 LoginPage -- 评分 8.5/10 (最佳页面)

**优点**:
- 左侧品牌区设计出色：深色背景 + 打字机动画 + 玻璃扇形卡片，视觉冲击力强
- 右侧表单极简克制，符合 Brave 风格的干净感
- 微交互品质高：typewriter loop、countUp 数字递增、stagger 入场动画、border-shimmer 流光
- 版权信息延迟淡入体现了动画编排意识

**待改进**:
- P3: 登录按钮使用 `!important` 强制背景色 (`login-btn { background: #0f172a !important }`)，应改用更高优先级选择器或移除冲突样式
- P3: 移动端缺少左侧品牌区的精华展示，仅一个小 Logo + 文字过于简陋
- P4: 表单 focus 状态仅改变 border-color 到 `#94a3b8`（灰色），缺少品牌色呼应，建议 focus 时使用 `border-brand-500` + `ring`

### 2.2 DashboardPage -- 评分 7.5/10

**优点**:
- 5 列 KPI 卡片结构清晰，每张卡片有独立色彩标识
- 月度柱状图渐变色美观，tooltip 样式精致
- 团队负载板块的实时脉冲指示器（animate-ping）增加了活力感
- 利用率进度条渐变效果流畅

**待改进**:
- P1: **KPI 卡片代码完全硬编码**。5 张卡片各 ~20 行内联 className，shadow/border/hover 字符串完全重复 5 次。已有 `StatCard` 组件（`components/ui/StatCard.jsx`）但未使用，造成维护困难且违背 DRY 原则
- P2: 周趋势箭头方向有歧义 -- 上升用的 SVG 实际是一个下箭头做 `rotate(180)`，代码可读性差
- P2: "设计中"卡片右上角无 badge/trend，与其他卡片结构不一致，视觉节奏断裂
- P3: 设计师排行表格的排名圆标颜色（金/银/铜）是合理的，但第 1 名用 `bg-amber-50` 过于淡，缺乏 "金牌" 的视觉冲击
- P3: 图表容器 min-height 用 `340px` / `380px` 硬编码，在超大屏上留白过多

### 2.3 OrdersPage -- 评分 7.0/10

**优点**:
- Tab 筛选 + 搜索布局紧凑合理，待处理 Tab 有 badge 计数
- 表格行 hover 效果柔和
- 分页器底栏有自动刷新指示器，体现运营意识
- 空状态有图标 + 双行文本，比纯文字好

**待改进**:
- P1: **表格缺少样式定义**。`<table>` 和 `<thead>/<th>/<td>` 均无 className（仅 thead 有 bg 色），依赖浏览器默认样式，导致列宽不可控、文字未对齐、缺少 padding
- P1: 搜索框同时有 `py-2.5` 和 `py-1.5` 两个冲突的 padding class -- 后者覆盖前者，但意图不清
- P2: 操作按钮在行内堆叠，多状态按钮 + 更多菜单在窄屏时容易溢出换行，缺少 overflow 策略
- P2: 更多操作下拉菜单（dropdown）没有三角指示器，视觉上不清楚归属哪个触发按钮
- P3: 订单号链接色 `#465FFF` 与品牌色一致，但在表格密集信息中不够突出，建议 hover 时加底色背景而非仅 underline

### 2.4 OrderDetailPage -- 评分 7.5/10

**优点**:
- 三栏布局（信息 + 利润 | 时间线）信息架构清晰
- 利润明细四格卡片用不同底色区分，直觉性好
- 时间线垂直连线用渐变色，最新节点有品牌色实心 + 光晕效果

**待改进**:
- P2: 操作栏 action bar 按钮过多时水平排列容易超出容器宽度，缺少 flex-wrap 后的视觉整理
- P2: 返回按钮仅一个左箭头，缺少文字提示（如 "返回订单列表"），可发现性低
- P3: 基本信息网格的 label 使用 `text-[11px] uppercase tracking-wider`，对中文没有意义（中文无大小写），建议去掉 uppercase
- P3: 时间线在数据未加载时显示 spinner + "加载中..." 文字，但空时间线（0 条记录成功加载后）无空状态提示

### 2.5 RevenuePage -- 评分 7.5/10

**优点**:
- 日期范围选择器（7/14/30 天）使用 pill-toggle 分段控件，交互直觉
- DeltaBadge 组件封装得当，环比数据可视化清晰
- 两张 ECharts 图表 tooltip 风格统一，利润构成堆叠图有自定义 formatter
- CSV 导出功能实用

**待改进**:
- P2: 导出按钮使用 `rounded-lg` 而 KPI 卡片使用 `rounded-2xl`，同一页面圆角不一致
- P2: "净利润率" 卡片右上角无 DeltaBadge（其他 3 张有），结构不对称
- P3: Top 设计师排行表格与 Dashboard 的设计师排行表格样式不同（表头字号、间距、排名徽章大小），两处应统一
- P3: 日期范围 toggle 在移动端与标题堆叠时缺少 `flex-wrap` 适配

### 2.6 TeamPage -- 评分 7.0/10

**优点**:
- 卡片式布局展示成员状态，hover 边框变化有品牌色呼应
- 负载进度条颜色随数值变化（绿/黄/红），信息编码合理
- 空状态设计精致（大圆标 + 标题 + 描述）

**待改进**:
- P2: 卡片底部 "活跃订单 X / 10" 中 `/10` 的最大值硬编码，无法反映真实上限
- P2: 卡片只有头像首字母，无真实头像或颜色区分（所有成员都是相同的蓝底白字），在多成员时辨识度低
- P3: 收起侧边栏后卡片网格未重新适配，4 列可能过密
- P3: 进度条缺少 aria-valuenow/aria-valuemax 无障碍属性

### 2.7 EmployeesPage -- 评分 7.0/10

**优点**:
- 批量操作 + 排序 + 搜索 + 展开行，功能完整度高
- Toggle switch 开关样式精致，有确认弹窗防误操作
- 激活码弹窗突出显示码值 + 一键复制
- 展开行用 animate-fade-in-up 过渡

**待改进**:
- P1: 同 OrdersPage，`<table>` 缺少基础样式（th/td 无 padding/font-size/border），依赖外部或默认样式
- P2: 添加员工 Modal 缺少遮罩点击关闭（仅有 X 按钮关闭），与 ConfirmModal 行为不一致
- P2: 角色选择 `<select>` 在不同浏览器下渲染差异大，建议替换为自定义下拉组件
- P3: 设备指纹显示截断 `substring(0, 16) + '...'`，但鼠标悬停 tooltip 为原生 title 属性，在触屏设备上不可见

### 2.8 AppShell (侧边栏 + 顶栏) -- 评分 7.5/10

**优点**:
- 侧边栏深色主题 `#1C2434` 对比度高，nav 激活态有蓝色竖条指示器
- 收起/展开过渡流畅（`transition-all duration-300`）
- 面包屑导航 + 时钟 + WebSocket 状态指示器信息丰富但不拥挤
- 通知铃铛未读计数带 pulse 动画

**待改进**:
- P2: 侧边栏用 `dangerouslySetInnerHTML` 渲染 nav icon SVG，存在 XSS 风险且无法享受 React 生命周期
- P2: 用户头像区域既是展示又有退出按钮，hover 态覆盖区域大但仅退出按钮可点击，容易误触
- P3: 侧边栏收起时 nav item 无文字 tooltip（只有 `title` 属性），移动端体验差
- P3: 移动端汉堡菜单图标到侧边栏展开无过渡动画，突然出现

### 2.9 通用组件库 (components/ui/) -- 评分 6.5/10

**优点**:
- `Button`、`Card`、`Badge`、`StatCard` 组件设计合理，用 `cn()` 合并 className
- Button 有 variant（primary/secondary/danger/success/ghost）和 size（xs/sm/md）体系
- Card + CardHeader 可组合使用

**关键问题**:
- P1: **组件库几乎未被页面使用**。Dashboard/Orders/Revenue/Team/Employees 页面全部使用内联样式硬编码按钮、卡片、badge。ui/ 组件库形同虚设
- P1: Badge 组件在 `components/Badge.jsx` 和 `components/ui/Badge.jsx` 双重存在，前者未使用
- P2: 缺少 Input、Select、Table、Modal 等高频组件的封装
- P2: `PageHeader`、`RefreshButton` 组件已创建但同样未在任何页面引用

---

## 三、设计一致性问题汇总

### 3.1 颜色体系

**已定义的 Design Token** (index.css @theme):
```
brand-500: #465FFF    brand-600: #3641F5    brand-700: #2B35CF
success: #22AD5C      warning: #F59E0B      danger: #F04438
```

**问题**: 页面中大量直接使用硬编码色值而非 token：
- `bg-[#465FFF]` 出现 20+ 次（应使用 `bg-brand-500`）
- `bg-[#EFF4FF]` 出现 10+ 次（应使用 `bg-brand-50`）
- `text-[#465FFF]` 出现 15+ 次（应使用 `text-brand-500`）
- `bg-[#DAF8E6]` 出现 8+ 次（应使用 `bg-success-bg`）
- `bg-[#FEF4E4]` 出现 6+ 次（应使用 `bg-warning-bg`）

这不仅增加维护成本，且一旦调整品牌色需全局搜索替换。

### 3.2 圆角不一致

| 场景 | 使用值 | 建议统一值 |
|------|--------|-----------|
| 卡片容器 | `rounded-2xl` (16px) | 16px |
| 按钮 (页面内联) | `rounded-xl` (12px) | 10px |
| Badge | `rounded-full` (9999px) | 9999px |
| 输入框 | `rounded-xl` 和 `rounded-lg` 混用 | 10px |
| 下拉菜单 | `rounded-xl` | 12px |
| 图表tooltip | `border-radius: 10px` (CSS) / `8px` | 10px |

### 3.3 阴影不一致

Dashboard、Orders、Revenue 卡片使用相同的长 shadow 字符串：
```
shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]
hover:shadow-[0_4px_16px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.03)]
```
这段字符串重复出现 30+ 次。应提取为 Tailwind 自定义 utility 或使用 Card 组件。

### 3.4 字体使用

- 标题字体 `font-[Outfit]` 使用正确
- 但 `@import` 或 `<link>` 中未发现 Google Fonts 加载 Outfit 和 Inter 的声明，可能依赖 CDN 或未正确加载（需确认 index.html）
- 数字统一使用 `tabular-nums`，这是好的实践

### 3.5 间距体系

页面内部间距基本统一：
- 页面顶层容器 gap: `gap-5` 或 `gap-7`（不一致）
- 卡片内 padding: `p-5 lg:p-6`（一致）
- 卡片头部: `px-5 lg:px-7 py-5`（一致）
- 建议统一页面容器 gap 为 `gap-6`

---

## 四、交互体验问题

### 4.1 Loading 状态
- **已做**: 全页 LoadingSpinner（绝对定位覆盖）、按钮 loading spin、图表区域 spinner
- **缺失**:
  - Skeleton 占位动画已在 CSS 中定义（`.skeleton` class）但从未在组件中使用
  - KPI 卡片数据加载时显示的是 "0" 而非骨架屏，首屏体验差（先闪 0，再跳到真实值）
  - 表格切换 tab 时无过渡动画，数据直接替换

### 4.2 空状态
- **已做**: 订单列表、团队监控、通知面板都有定制空状态
- **缺失**:
  - Dashboard 的设计师排行在无数据时整个区块隐藏（条件渲染），用户不知道存在此功能
  - Revenue 图表在数据为空时仍渲染空坐标轴，建议叠加空状态提示

### 4.3 错误状态
- **已做**: 登录错误提示有 AlertCircle 图标 + 红色背景
- **缺失**:
  - API 调用失败仅用 toast 通知，页面内容保持旧数据或为空，无 inline 错误重试引导
  - WebSocket 断连后无全局 banner 提示用户数据可能不是最新的

### 4.4 表单校验
- 登录表单仅检查非空，无格式提示
- 添加员工弹窗的企微 UserID 格式无验证提示
- 所有 input 缺少 error 态样式（红色边框 + 错误文字）

---

## 五、响应式适配问题

### 5.1 断点覆盖

| 断点 | 覆盖情况 | 问题 |
|------|---------|------|
| < 640px (手机竖屏) | 基本覆盖 | Dashboard 5 列 KPI 卡变 2 列，但 1 列状态下留白过大 |
| 640-768px (手机横屏) | 较弱 | 表格横向滚动无提示，用户不知道可以左右滑动 |
| 768-1024px (平板) | 较弱 | 侧边栏自动收起但内容区域未重排 |
| 1024-1280px (小笔记本) | 一般 | Dashboard 月度图表与团队负载 2:1 分栏在此宽度下图表偏窄 |
| > 1400px (大屏) | 一般 | 内容 max-width 限制 1400px，超大屏两侧留白过多 |

### 5.2 具体问题

1. **OrdersPage 表格**: 无 `min-width` 约束，窄屏下列会被压缩到不可读
2. **EmployeesPage 表格**: 8-9 列在平板上完全无法展示，需要滚动但无滚动指示
3. **RevenuePage**: 图表容器高度固定 `h-[380px]`，在手机上占据大量屏幕空间
4. **登录页**: 左侧面板 `hidden lg:flex` 在平板上不显示，右侧占满但表单太窄（max-w-[320px]）
5. **通知面板**: 固定宽度 `w-80` (320px)，在小屏可能溢出视口

---

## 六、对标 Brave 风格改进建议

### 6.1 Brave 风格特征提炼

Brave 官网的核心设计语言：
1. **大面积深色/深紫色背景** + 白色内容形成强对比
2. **渐变光效**：标题文字渐变、卡片边缘微光、CTA 按钮渐变
3. **极简信息密度**：每个视觉区块只做一件事
4. **大字号标题** + 充分留白
5. **圆润但不过度**的组件形态

### 6.2 当前差距与改进方向

**A. 背景与主题色运用** (优先级: P1)

当前：所有内页背景为 `#F1F5F9`（浅灰），卡片白色。虽然干净但缺少品牌辨识度。

建议：
- 顶部 Header 区域可加入极淡的品牌色渐变背景 `linear-gradient(135deg, #F5F8FF 0%, #F1F5F9 50%)`
- Dashboard 标题区可增加一个品牌色渐变 hero 横幅，类似 Brave Dashboard 的 "Welcome back" 区域
- 考虑 Dark Mode 支持（Brave 默认深色主题）

**B. 渐变与光效** (优先级: P2)

当前：仅柱状图有渐变，按钮/卡片/标题均为纯色。

建议：
- 主操作按钮（CTA）使用品牌色渐变背景：`linear-gradient(135deg, #465FFF, #6366F1)`
- KPI 卡片 hover 时 border 可加微妙的品牌色光晕：`box-shadow: 0 0 0 1px rgba(70,95,255,0.1), 0 4px 16px rgba(70,95,255,0.06)`
- 页面标题可尝试品牌色到深色的文字渐变（仅标题文字，非全文）

**C. 留白与信息密度** (优先级: P2)

当前：表格和卡片内容较密集，尤其订单列表和员工管理页。

建议：
- 表格行高从当前的 `py-3.5` 提升到 `py-4`
- 表格列间距从 `px-4` 提升到 `px-5`
- 卡片间 gap 从 `gap-4` 统一到 `gap-5`
- 段落间距增加 `space-y-1` 到 `space-y-2`

**D. 动效精致度** (优先级: P3)

当前：基础 hover/transition 已有，但缺少"精致感"。

建议（参考 uiverse.io 效果）：
- 按钮 hover 增加微妙的上移效果：`hover:-translate-y-[1px]`
- KPI 卡片点击时加 `active:scale-[0.98]` 反馈
- 表格行 hover 时左侧加 3px 品牌色竖线指示（类似侧边栏 nav）
- 页面切换加 `page-enter` 动画已有，但建议增加 `page-exit` 淡出避免突兀切换

---

## 七、具体可执行的设计改进计划 (按优先级排序)

### P0 -- 基础设施 (立即修复)

1. **统一使用 Design Token 替换硬编码色值**
   - 全局替换 `bg-[#465FFF]` -> `bg-brand-500`
   - 全局替换 `text-[#465FFF]` -> `text-brand-500`
   - 全局替换 `bg-[#EFF4FF]` -> `bg-brand-50`
   - 全局替换 `bg-[#DAF8E6]` -> `bg-success-bg`
   - 全局替换 `bg-[#FEE4E2]` -> `bg-danger-bg`
   - 全局替换 `bg-[#FEF4E4]` -> `bg-warning-bg`
   - 估计影响: 100+ 处

2. **让页面实际使用 ui/ 组件库**
   - Dashboard KPI 卡片改用 `StatCard` 组件
   - 所有按钮改用 `Button` 组件
   - 所有卡片容器改用 `Card` + `CardHeader`
   - 所有 badge 改用 `Badge` 组件
   - 删除 `components/Badge.jsx` 重复文件

3. **表格基础样式补全**
   - 在 `index.css` 中添加全局 table 样式：
     ```css
     table { width: 100%; border-collapse: separate; border-spacing: 0; }
     th { padding: 14px 16px; font-size: 12px; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; border-bottom: 1px solid #E2E8F0; }
     td { padding: 14px 16px; font-size: 13px; color: #334155; border-bottom: 1px solid #F1F5F9; }
     ```

### P1 -- 视觉提升 (一周内)

4. **提取公共阴影 utility**
   - 在 Tailwind 配置或 CSS 中定义：
     ```css
     .shadow-card { box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02); }
     .shadow-card-hover { box-shadow: 0 4px 16px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.03); }
     ```

5. **KPI 卡片骨架屏**
   - 数据加载中时显示 `.skeleton` 占位而非数字 "0"
   - 每张卡片高度固定，避免数据到达时页面跳动

6. **主操作按钮渐变升级**
   - CTA 按钮背景改为 `linear-gradient(135deg, #465FFF, #6366F1)`
   - hover 态加微妙上移 + 光晕

7. **Dashboard 欢迎横幅**
   - 在 KPI 区域上方增加一个轻量级的欢迎/概览横幅
   - 品牌色渐变背景 + 用户名 + 今日概况文字

### P2 -- 交互优化 (两周内)

8. **表格响应式改进**
   - 添加水平滚动提示（渐变遮罩 + 左右箭头）
   - 关键列（如订单号、状态）设置 `sticky` 固定
   - 手机端考虑将表格切换为卡片列表视图

9. **封装 Input / Select / Table 组件**
   - `Input`: 统一 focus/error/disabled 态样式
   - `Select`: 自定义下拉替代原生 select
   - `Table`: 封装表头/排序/空状态/loading 态

10. **通知面板优化**
    - 添加分类 Tab (全部/未读)
    - 超出视口时改用 slide-over 而非 dropdown
    - 添加 "查看更多" 跳转链接

11. **全局错误处理 banner**
    - WebSocket 断连时在顶部显示黄色警示条
    - API 批量失败时在对应区域显示 inline 重试按钮

### P3 -- 精致感提升 (持续迭代)

12. **微交互动画增强**
    - 表格行 hover 左侧竖线指示器
    - 按钮 hover 微上移 + active 微缩
    - Tab 切换时 underline 滑动动画 (而非瞬间切换)
    - 数据刷新时数字 count-up 过渡

13. **图标系统统一**
    - 当前混用 inline SVG + lucide-react (仅登录页)
    - 建议统一使用 lucide-react 或 heroicons 包
    - 减少 inline SVG 代码量（当前超过 50 处 inline SVG）

14. **Dark Mode 支持**
    - 利用 Tailwind `dark:` 前缀
    - 侧边栏已天然深色，内容区需定义深色 token
    - 参考 Brave 深色主题配色

15. **加载 Google Fonts**
    - 确认 `index.html` 中正确 preload Outfit + Inter 字体
    - 使用 `font-display: swap` 避免 FOIT

---

## 八、建议的设计规范 (Design System Reference)

### 8.1 配色规范

| Token | 值 | 用途 |
|-------|-----|------|
| brand-50 | #EFF4FF | 图标背景、轻高亮 |
| brand-100 | #D1E0FF | hover 图标背景 |
| brand-500 | #465FFF | 主色、按钮、链接、激活态 |
| brand-600 | #3641F5 | hover 态 |
| brand-700 | #2B35CF | active 态 |
| success | #22AD5C | 成功状态 |
| success-bg | #DAF8E6 | 成功背景 |
| warning | #F59E0B | 警告状态 |
| warning-bg | #FEF4E4 | 警告背景 |
| danger | #F04438 | 危险状态 |
| danger-bg | #FEE4E2 | 危险背景 |
| sidebar-bg | #1C2434 | 侧边栏背景 |
| page-bg | #F1F5F9 | 页面背景 |
| surface | #FFFFFF | 卡片/面板表面 |
| text-primary | #1E293B | 主要文本 |
| text-secondary | #64748B | 次要文本 |
| text-muted | #94A3B8 | 辅助文本 |
| border | #E2E8F0 | 分割线、边框 |

### 8.2 间距规范

| 场景 | 值 | Tailwind |
|------|-----|---------|
| 页面外边距 | 20px / 32px | `p-5 lg:p-8` |
| 卡片间距 | 20px / 24px | `gap-5 lg:gap-6` |
| 卡片内边距 | 20px / 24px | `p-5 lg:p-6` |
| 卡片头部内边距 | 20px-28px / 20px | `px-5 lg:px-7 py-5` |
| 表单字段间距 | 20px | `mb-5` |
| 紧凑元素间距 | 8px | `gap-2` |
| 相关元素间距 | 12px-16px | `gap-3 / gap-4` |

### 8.3 圆角规范

| 场景 | 值 | Tailwind |
|------|-----|---------|
| 卡片/面板 | 16px | `rounded-2xl` |
| 按钮 | 12px | `rounded-xl` |
| 输入框 | 12px | `rounded-xl` |
| Badge/Tag | 9999px | `rounded-full` |
| 图标容器 | 12px | `rounded-xl` |
| 下拉菜单 | 12px | `rounded-xl` |
| Modal | 16px | `rounded-2xl` |
| 头像 | 9999px | `rounded-full` |

### 8.4 阴影规范

| 场景 | 值 |
|------|-----|
| 卡片默认 | `0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)` |
| 卡片 hover | `0 4px 16px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.03)` |
| 下拉菜单 | `0 10px 25px rgba(0,0,0,0.1), 0 4px 10px rgba(0,0,0,0.05)` |
| Modal | `0 25px 50px rgba(0,0,0,0.15)` |
| 按钮 (primary) | `0 1px 2px rgba(70,95,255,0.2)` |

### 8.5 字体规范

| 场景 | 字体 | 大小 | 粗细 |
|------|------|------|------|
| 页面标题 | Outfit | 26px | 800 (extrabold) |
| 卡片标题 | Outfit | 18px | 700 (bold) |
| KPI 数值 | Outfit | 28px (lg) / 24px | 700 |
| 正文 | Inter | 14px | 400 |
| 表头 | Inter | 12px | 600, uppercase |
| 表格正文 | Inter | 13px | 400/500 |
| Badge | Inter | 12px | 600 |
| 辅助文字 | Inter | 11-12px | 500 |

### 8.6 动画规范

| 场景 | 曲线 | 时长 |
|------|------|------|
| hover 过渡 | ease | 150-200ms |
| 页面入场 | cubic-bezier(0.16, 1, 0.3, 1) | 350ms |
| Modal 入场 | cubic-bezier(0.16, 1, 0.3, 1) | 250ms |
| 折叠/展开 | ease-in-out | 300ms |
| 数据加载显示 | ease-out | 300ms |
| 进度条 | ease-out | 700ms |

---

## 九、总结

当前前端 UI 整体品质在 **中上水平**，视觉风格统一性较好，登录页的设计品质可以视为项目的标杆。主要的提升空间集中在三个方面：

1. **组件化落地不足**: `ui/` 目录下已有良好的组件封装，但页面全部使用内联硬编码样式，导致大量重复代码和维护隐患。这是最应优先解决的问题。

2. **设计 Token 使用率低**: Design Token 已在 CSS @theme 中定义，但页面中大量使用 `[#hex]` 硬编码覆盖，削弱了设计系统的价值。

3. **表格系统缺失**: 作为 B 端管理系统，表格是最高频的组件，但当前表格缺少统一的基础样式和响应式策略。

若能依次解决以上三项，UI 品质可从 7.2 提升到 8.5+ 水平，接近 Brave 品质的简约精致感。

---

*审查人: 设计师视角审查员 (Designer Reviewer Agent)*
*报告生成时间: 2026-03-19*
