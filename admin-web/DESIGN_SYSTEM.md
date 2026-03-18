# PDD 企微中控 — 前端设计规范

> 本文档定义项目的视觉设计语言，所有页面和组件必须遵循此规范。
> 设计哲学参考 Brave / Linear / Vercel — **克制、紧凑、高对比、零装饰**。

---

## 1. 设计原则

| 原则 | 说明 |
|------|------|
| **做减法** | 能用文字说的不用图标，能用边框分的不用阴影，能省的装饰全部省掉 |
| **紧凑不拥挤** | 元素之间间距紧凑有节奏，留白出现在页面边缘，不在内容中间形成空洞 |
| **高对比** | 黑白为主，一个品牌强调色，文字层级靠透明度区分而非多种颜色 |
| **功能优先** | 每个视觉元素必须有功能目的，拒绝纯装饰（渐变光晕、粒子动画、纹理背景） |
| **克制字重** | 最重用 `semibold`（600），标题不用 `bold`/`extrabold`，正文用 `normal`/`medium` |

---

## 2. 配色系统

### 核心色板（仅 5 种角色）

| 角色 | 色值 | 用途 |
|------|------|------|
| **深黑** | `#0a0a0f` | 深色背景、主按钮 |
| **正文黑** | `#0f172a` | 标题、正文、按钮文字 |
| **中灰** | `#64748b` | 次级文字、标签 |
| **浅灰** | `#94a3b8` | 占位符、辅助说明 |
| **品牌紫** | `#4f46e5` | Logo、链接、选中态、单一强调色 |

### 文字透明度层级（深色背景上）

| 层级 | 透明度 | 用途 |
|------|--------|------|
| Primary | `white/90` | 标题、核心数字 |
| Secondary | `white/70` | 副标题、品牌名 |
| Tertiary | `white/30` | 描述文字 |
| Quaternary | `white/15 ~ white/25` | 底部版权、极弱辅助 |

### 文字透明度层级（白色背景上）

| 层级 | 色值 | 用途 |
|------|------|------|
| Primary | `#0f172a`（slate-900） | 标题 |
| Secondary | `#475569`（slate-600） | 标签、表单 label |
| Tertiary | `#94a3b8`（slate-400） | 描述、副文字 |
| Quaternary | `#cbd5e1`（slate-300） | 占位符、极弱提示 |

### 状态色

| 状态 | 文字 | 背景 | 边框 |
|------|------|------|------|
| 错误 | `#dc2626` | `#fef2f2` | `#fecaca` |
| 成功 | `#16a34a` | `#f0fdf4` | `#bbf7d0` |
| 警告 | `#d97706` | `#fffbeb` | `#fde68a` |

---

## 3. 字体系统

### 字体栈
```css
body:   'Inter', -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
标题:    'Outfit', sans-serif;  /* 仅用于品牌区大标题 */
等宽:    ui-monospace, 'SF Mono', Menlo, monospace;  /* 密码、代码、金额 */
```

### 字号层级（8px 倍数系统）

| 层级 | 大小 | 字重 | 行高 | 用途 |
|------|------|------|------|------|
| **Display** | 40-44px | 600 | 1.15 | 登录页左侧大标语 |
| **H1** | 24px | 600 | 1.3 | 页面主标题 |
| **H2** | 20px | 600 | 1.35 | 区块标题、卡片标题 |
| **H3** | 16px | 500 | 1.4 | 次级区块标题 |
| **Body** | 14px | 400 | 1.5 | 正文、表格内容 |
| **Small** | 13px | 400/500 | 1.45 | 表单 label、按钮文字、辅助说明 |
| **Caption** | 12px | 400 | 1.4 | 时间戳、页脚、badge |
| **Micro** | 11px | 400 | 1.35 | 极小标签、版权 |

---

## 4. 间距系统

基础单位：**4px**，常用倍数：4 / 8 / 12 / 16 / 24 / 32 / 48 / 64

| 用途 | 间距 | Tailwind |
|------|------|----------|
| 同组元素内部（label → input） | 6px | `mb-1.5` |
| 表单字段之间 | 16px | `mb-4` |
| 区块标题 → 内容 | 12-16px | `mb-3` ~ `mb-4` |
| 区块之间 | 24-32px | `mb-6` ~ `mb-8` |
| 页面内边距 | 48-64px | `px-12` ~ `px-16` |
| 页面顶部/底部 | 40px | `py-10` |

### 间距原则
- 关联元素（label 和 input）间距 **小**（6px）
- 平级元素（字段和字段）间距 **中**（16px）
- 不同区块之间间距 **大**（24-32px）
- 页面边缘留白 **最大**（48-64px）

---

## 5. 组件规范

### 输入框 (Input)

```
高度:      40px
字号:      13px
内边距:    0 12px
背景:      #ffffff
边框:      1px solid #e2e8f0
圆角:      6px
Focus:     border-color: #94a3b8（变深，不发光）
占位符色:  #c8ced6
```

**禁止**: 输入框前缀图标（User/Lock 等）、发光 ring、大圆角(12px+)、背景色变化

### 按钮 (Button)

| 类型 | 背景 | 文字 | 边框 |
|------|------|------|------|
| Primary | `#0f172a` | `#ffffff` | 无 |
| Secondary | `transparent` | `#0f172a` | `1px solid #e2e8f0` |
| Ghost | `transparent` | `#64748b` | 无 |
| Danger | `#dc2626` | `#ffffff` | 无 |

```
高度:      40px（大按钮）/ 32px（小按钮）
字号:      13px
字重:      500
圆角:      6px
Hover:     opacity: 0.88（主按钮）/ bg-slate-50（次级）
```

**禁止**: 渐变色、大阴影(shadow-lg+)、上浮动效(translateY)、多色按钮

### 卡片 (Card)

```
背景:      #ffffff
边框:      1px solid #e2e8f0
圆角:      8px
阴影:      无 或 0 1px 2px rgba(0,0,0,0.05)（极淡）
内边距:    16-24px
```

**禁止**: 大阴影、渐变边框、hover 放大、光晕效果

### 表格 (Table)

```
表头背景:  #f8fafc
表头字号:  12px，font-weight: 500，color: #64748b，text-transform: uppercase
行高:      48px
行边框:    1px solid #f1f5f9（极淡）
Hover:     bg-slate-50
```

### 复选框 (Checkbox)

```
大小:      14px × 14px
圆角:      3px（rounded-sm）
未选中:    border: 1px solid #cbd5e1
选中:      bg: #0f172a, border: #0f172a, 白色勾
```

### Badge / Tag

```
字号:      11-12px
字重:      500
内边距:    2px 8px
圆角:      4px
风格:      浅色背景 + 深色文字（如 bg-emerald-50 text-emerald-700）
```

---

## 6. 布局规范

### 页面结构
```
Sidebar (固定 240px) + Main Content (flex-1)
```

### 内容区
```
最大宽度:   1200px（居中）
内边距:     24-32px
```

### 响应式断点

| 断点 | 宽度 | 策略 |
|------|------|------|
| Mobile | < 768px | 隐藏 sidebar，单列布局 |
| Tablet | 768-1024px | 折叠 sidebar（图标模式） |
| Desktop | > 1024px | 完整 sidebar + 内容区 |

---

## 7. 动画规范

| 场景 | 动画 | 时长 |
|------|------|------|
| 页面进入 | fadeIn + translateY(4px) | 200ms |
| Modal 弹出 | scale(0.97) → scale(1) + fadeIn | 150ms |
| Hover 过渡 | opacity / color / border 变化 | 150ms |
| 按钮点击 | 无位移，仅 opacity | — |
| 加载状态 | Loader2 rotate | 持续 |

**禁止**: translateY 上浮、弹跳(bounce)、pulse 光晕、粒子/Canvas 动画

---

## 8. 反面清单（绝对禁止）

以下元素会产生"AI味"，在任何页面中**严禁使用**：

- 多色渐变背景 / 渐变光晕 / blur 光效
- Canvas 粒子动画
- 输入框/卡片的发光 ring (ring-4 ring-xxx/10)
- 按钮的 translateY 上浮 + 大投影
- 多色配色方案（超过 1 个强调色）
- font-weight: 800/900 (extrabold/black)
- 圆角 > 8px 的容器（除 avatar/badge）
- 纯装饰性的网格纹理、渐变条纹
- "欢迎回来""安全登录" 等冗余话术
- 功能亮点/Feature 列表卡片（在登录页）

---

## 9. 技术约定

- **框架**: React 19 + Vite 6
- **样式**: Tailwind CSS v4（CSS-native mode）
- **图标**: lucide-react（按需导入，不全量引入）
- **图表**: ECharts v6
- **字体**: Google Fonts — Inter + Outfit
- **组件**: 手写 + Tailwind，不引入第三方 UI 库
- **CSS 自定义样式**: 写在 `index.css` 中，使用 `.login-input` / `.login-btn` 等语义类名
- **Tailwind 优先级问题**: 全局 CSS reset 不要写 `padding: 0` / `margin: 0`（Tailwind v4 preflight 已包含）

---

*最后更新: 2026-03-18*
