# PDD 派单系统 -- UI 设计规范 v1.0

本文档是前端 UI 设计的唯一参考标准，所有新增/修改 UI 必须遵循此规范。

---

## 1. 色彩系统

### 品牌色（Primary）
| Token | 值 | 用途 |
|-------|-----|------|
| `brand-25` | `#F5F3FF` | 极浅背景 |
| `brand-50` | `#EDE9FE` | 浅色背景、hover 态 |
| `brand-100` | `#DDD6FE` | 输入框 focus ring |
| `brand-200` | `#C4B5FD` | 滚动条、次要装饰 |
| `brand-500` | `#434FCF` | **主色**，按钮/链接/图标/focus |
| `brand-600` | `#3B3FBF` | hover 态 |
| `brand-700` | `#312E9F` | active 态 |

**禁止**: 使用 `#465FFF`、Tailwind 默认 `blue-*`、或任何未在 token 中定义的蓝色。

### 状态色
| 语义 | 色值 | 背景 | 用途 |
|------|------|------|------|
| 成功 | `#10B981` | `#ECFDF5` | 完成、通过、正增长 |
| 警告 | `#F59E0B` | `#FFFBEB` | 待处理、即将超时 |
| 危险 | `#EF4444` | `#FEF2F2` | 错误、售后、负增长 |
| 信息 | `#3B82F6` | `#EFF6FF` | 提示、设计中 |

### 灰度（文字/边框）
| 用途 | 值 | Tailwind |
|------|-----|----------|
| 标题文字 | `#111827` | `text-slate-900` |
| 正文文字 | `#1E293B` | `text-slate-800` |
| 次要文字 | `#64748B` | `text-slate-500` |
| 辅助文字 | `#94A3B8` | `text-slate-400` |
| 占位符 | `#CBD5E1` | `text-slate-300` |
| 边框 | `rgba(0,0,0,0.06)` | `ghost-border` 类 |
| 分割线 | `#E2E8F0` | `border-slate-200` |

---

## 2. 字体

| 用途 | 字体族 | 样式 |
|------|--------|------|
| 标题 / 数字 | `Outfit` | font-weight: 600-800, letter-spacing: -0.02em |
| 正文 / UI | `Inter` | font-weight: 400-600 |
| 等宽数据 | `tabular-nums` 特性 | 金额、日期、编号 |

---

## 3. 圆角

| 元素 | 圆角 | Tailwind |
|------|------|----------|
| 按钮 | 12px | `rounded-xl` |
| 卡片 | 16px | `rounded-2xl` |
| 输入框 | 12px | `rounded-xl` |
| 头像 | 10-14px | `rounded-[10px]` ~ `rounded-[14px]` |
| 徽标 | 全圆 | `rounded-full` |
| 图标容器 | 12px | `rounded-xl` |
| 弹窗 | 16px | `rounded-2xl` |

---

## 4. 间距

| 场景 | 规范 |
|------|------|
| 卡片内边距 | `p-5 lg:p-6`（20px / 24px） |
| 卡片标题栏 | `px-5 lg:px-7 py-5` |
| 元素间距（同级） | `gap-4`（16px）或 `gap-5`（20px） |
| 图标与文字 | `gap-2`（8px）或 `gap-3`（12px） |
| 页面级间距 | `gap-5`（20px）或 `gap-6`（24px） |
| 表格单元格 | `px-4 py-3`（标准）或 `px-6 py-3.5`（宽松） |

---

## 5. 图标规范

### 来源
统一使用 **lucide-react** 图标库：https://lucide.dev/icons/

### 尺寸标准
| 场景 | 尺寸 | 示例 |
|------|------|------|
| KPI 卡片图标 | 20px (`w-5 h-5`) | 搭配 44px 容器 |
| MetricCard 图标 | 18px (`w-[18px] h-[18px]`) | 搭配 32px 容器 |
| 按钮内图标 | 16px (`w-4 h-4`) | 行内按钮 |
| 导航图标 | 20px (`w-5 h-5`) | 侧边栏 |
| 表格操作图标 | 16px (`w-4 h-4`) | 编辑/删除 |
| 空状态图标 | 48px (`w-12 h-12`) | 居中展示 |

### 图标容器
- 尺寸: `w-11 h-11`（44px）用于 KPI 卡片
- 尺寸: `w-8 h-8`（32px）用于 MetricCard、表格标题
- 背景: 主题色 + `15` 透明度（如 `${color}15`）
- 圆角: `rounded-xl`（12px）或 `rounded-[14px]`

### 禁止
- 禁止使用内联 SVG 手绘图标（除非 lucide 确实没有对应图标）
- 禁止使用不同 strokeWidth（统一用 `strokeWidth={2}` 或 `1.5`）
- 禁止图标无 `aria-hidden="true"`（装饰性图标）

---

## 6. 组件设计规范

### 6.1 MetricCard（指标卡片）
- 背景: 白色，`ghost-border`
- 圆角: 16px
- 内边距: `22px 24px 20px`
- 布局: 垂直 → [图标+标题] → [大数字] → [趋势 pill]
- 图标容器: 32px, `rounded-[9px]`
- 大数字: Outfit 字体, `text-2xl lg:text-[28px]`, font-weight 700
- 趋势 pill: `rounded-full`, 12px 字号
- hover: `translateY(-2px)` + 品牌色光晕 shadow

### 6.2 KpiCard（设计师页等页面的简洁 KPI）
- 布局: 水平 → [图标容器] + [label + value]
- 图标容器: 44px, `rounded-[14px]`, 主题色 15% 背景
- label: 11px, uppercase, tracking-wider, `text-slate-400`
- value: 22px, Outfit, font-extrabold, `text-slate-900`

### 6.3 按钮
- 主要按钮: `bg-brand-500 hover:bg-brand-600 text-white rounded-xl`
- 次要按钮: `bg-white border border-slate-200 hover:bg-slate-50 rounded-xl`
- 危险按钮: `bg-red-50 text-red-600 border border-red-200 rounded-xl`
- 幽灵按钮: `bg-transparent hover:bg-slate-100 rounded-xl`
- 内边距: `px-4 py-2.5`（标准）, `px-3 py-1.5`（小号）
- 字号: `text-sm font-semibold`

### 6.4 表格
- 容器: `ghost-border rounded-xl` 卡片包裹
- 布局: `table-layout: fixed` + `colgroup` 百分比宽度
- 表头: 11px, uppercase, `text-slate-400`, tracking-wider
- 行 hover: `hover:bg-[#FAFBFC]`
- 分割: 无显式 border-bottom，用 hover 态区分行

### 6.5 弹窗
- overlay: `bg-black/50 backdrop-blur-sm`
- 容器: `rounded-2xl shadow-2xl max-w-md`
- 标题栏: `px-6 py-4 border-b bg-slate-50/80`
- 内容区: `px-6 py-5`
- 操作栏: `px-6 py-4 border-t bg-slate-50/50 flex justify-end gap-2.5`
- 动画: `animate-fade-in-up`
- 关闭: Escape 键 + 点击背景

---

## 7. 阴影

| 层级 | 值 | 用途 |
|------|-----|------|
| 默认 | `0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)` | 静态卡片 |
| hover | `0 4px 16px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.03)` | 卡片 hover |
| 弹出 | `0 2px 16px rgba(0,0,0,0.06)` | 图表卡片 |
| 弹窗 | Tailwind `shadow-2xl` | Modal |
| 品牌光晕 | `0 0 0 1.5px ${brand}30, 0 8px 24px ${brand}12` | MetricCard hover |
| 图标阴影 | `shadow-md` + 主题色 `/25` | StaffDashboard 图标 |

---

## 8. 动画

| 名称 | 时长 | 缓动 | 用途 |
|------|------|------|------|
| `fadeInUp` | 0.3s | `cubic-bezier(0.16, 1, 0.3, 1)` | 弹窗入场、元素入场 |
| `pageIn` | 0.35s | `cubic-bezier(0.16, 1, 0.3, 1)` | 页面切换 |
| `expandRow` | 0.3s | 同上 | 表格行展开 |
| hover transition | 0.15-0.2s | `ease` | 按钮/卡片 hover |
| `translateY(-1px)` | -- | -- | 微 hover 上浮 |
| `translateY(-2px)` | -- | -- | 卡片 hover 上浮 |

---

## 9. 响应式断点

| 断点 | 宽度 | 用途 |
|------|------|------|
| 默认 | `<640px` | 手机端，2 列 grid |
| `sm` | `≥640px` | 小平板，3 列 |
| `md` | `≥768px` | 平板 |
| `lg` | `≥1024px` | 桌面端，侧边栏展开 |
| `xl` | `≥1280px` | 大屏，4 列 grid |

### 内容最大宽度
- 页面内容: `max-w-[1400px] mx-auto`

---

## 10. 禁止事项

1. **禁止**使用内联 `style={{}}`（MetricCard 等历史代码后续迁移到 Tailwind）
2. **禁止**在组件中使用 JS `onMouseEnter/onMouseLeave` 实现 hover（用 CSS/Tailwind）
3. **禁止**像素和百分比混用设定表格列宽
4. **禁止**使用 `!important`
5. **禁止**在 `index.css` 中新增页面级样式（应在组件中用 Tailwind）
6. **禁止**手绘 SVG 图标替代 lucide-react
7. **禁止**使用 `blue-*` 等默认 Tailwind 色阶替代 `brand-*` token
8. **禁止**不同页面的相同 UI 模式使用不同样式
