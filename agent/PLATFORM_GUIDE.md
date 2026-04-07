# macOS 企微 UI 自动化平台经验指南

> 基于企业微信 macOS v5.0.7 的实战探测经验，供后续 Windows UIA 版本快速开发参考。

---

## 1. 企微桌面端 UI 结构图谱

### 1.1 主窗口结构

```
AXWindow title='企业微信'
  └─ AXSplitGroup (主容器)
      ├─ 左侧导航栏 (AXButton * N + AXImage * N)
      │   注意：这些按钮对 AX API 几乎不可见，没有 title/help 属性
      │   底部的"更多"按钮完全无法通过 AX 定位或点击
      ├─ AXSplitter v='60.0'
      └─ AXSplitGroup (内层 - 聊天/搜索区)
          ├─ AXButton h='发起群聊'
          ├─ AXTextField (顶部搜索框 - 关键入口！)
          ├─ AXScrollArea (聊天列表)
          ├─ AXSplitter
          ├─ AXTextField v='群名/聊天名' (当前聊天标题)
          ├─ AXStaticText v='群描述信息'
          ├─ AXButton h='聊天信息'
          ├─ AXButton h='添加群成员'   <-- invite_to_group 入口
          └─ AXSplitGroup (消息区+输入区)
```

**定位要点：**

- 主窗口通过 `AXUIElementCreateApplication(pid)` 获取，再找 `AXWindow` title 含 `企业微信`
- 内层 `AXSplitGroup` 是聊天区的容器，搜索框和群聊按钮都在这里
- `AXButton h='发起群聊'` 通过 `AXHelp` 属性匹配（不是 `AXTitle`）
- `AXButton h='添加群成员'` 同样通过 `AXHelp` 匹配
- 当前聊天标题通过 `AXTextField` 的 `AXValue` 获取

### 1.2 发起群聊 / 添加群成员弹窗

发起群聊和添加群成员共用完全一致的 AXSheet 结构：

```
AXSheet
  └─ AXSplitGroup
      ├─ [0] AXGroup (左侧 - 联系人选择区)
      │   ├─ AXTextField (搜索框)
      │   └─ AXScrollArea
      │       └─ AXOutline 或 AXTable
      │           └─ AXRow (每个联系人一行)
      │               └─ AXCell
      │                   ├─ AXTextArea v='成员名'        <-- 用这个匹配联系人
      │                   ├─ AXImage d='checkbox unselected/selected normal/disabled'
      │                   ├─ AXStaticText v='@微信'       <-- 外部联系人标识
      │                   └─ AXStaticText v='我的客户'     <-- 分类标签
      │
      ├─ [1] AXSplitter
      │
      └─ [2] AXGroup (右侧 - 已选成员区)
          ├─ AXStaticText v='发起群聊' 或 '添加群成员'
          ├─ AXScrollArea -> AXTable (已选成员列表)
          ├─ AXButton t='完成' 或 '确定'    <-- 成员>=2(建群) 或 >=1(邀请) 时启用
          └─ AXButton t='取消'
```

**弹窗定位方式：**

- AXSheet 是主窗口 (`AXWindow`) 的直接子元素
- 通过遍历主窗口的 `AXChildren` 查找 `AXRole == 'AXSheet'`
- 左侧 `AXGroup` 是 `AXSplitGroup` 的第 0 个子元素
- 右侧 `AXGroup` 是第 2 个子元素（跳过中间的 `AXSplitter`）

**联系人行的识别：**

- 每个 `AXRow` 下的 `AXCell` 包含该联系人所有信息
- 通过 `AXTextArea` 的 `AXValue` 匹配联系人名字
- checkbox 状态通过 `AXImage` 的 `AXDescription` 判断：
  - `checkbox unselected normal` = 未选中，可选
  - `checkbox selected normal` = 已选中
  - `checkbox unselected disabled` = 不可选（如已在群中）

### 1.3 添加好友流程（顶部搜索框方式）

```
步骤 1: 顶部搜索框输入手机号

步骤 2: 弹出 AXDialog 窗口（下拉搜索菜单）
   └─ AXScrollArea
       └─ AXTable
           └─ AXRow
               ├─ Row[0]: 进入全局搜索
               └─ Row[1]: 通过手机号搜索添加微信    <-- 点击这行

步骤 3: 弹出独立 AXWindow（搜索结果窗口）
   ├─ AXStaticText v='通过手机号搜索添加微信'
   ├─ AXTextField v='手机号'（已自动填入）
   ├─ AXStaticText v='搜索结果：'
   └─ AXGroup
       └─ AXScrollArea
           └─ AXTable
               └─ AXRow
                   └─ AXCell
                       ├─ AXStaticText v='用户名'   <-- 获取昵称
                       └─ AXButton t='添加'          <-- 点击添加

步骤 4: 弹出确认窗口（AXWindow sr='AXUnknown'）
   ├─ AXTextField v='默认验证消息'
   └─ AXButton t='发送添加邀请'                     <-- 点击发送
```

**AXDialog 定位：**

- AXDialog 是独立窗口，不是主窗口子元素
- 通过 `AXRole == 'AXDialog'` 或 `AXSubrole == 'AXDialog'` 筛选系统所有窗口
- 该窗口在搜索框输入后自动弹出

**搜索结果窗口定位：**

- 是独立 `AXWindow`，和主窗口同级
- 通过窗口中是否包含 `AXStaticText v='通过手机号搜索添加微信'` 来识别

**确认窗口定位：**

- 也是独立 `AXWindow`，`AXSubrole == 'AXUnknown'`
- 通过查找包含 `AXButton t='发送添加邀请'` 的窗口来定位

### 1.4 弹窗类型总结

| 场景 | 弹窗类型 | 窗口关系 | 定位方式 |
|---|---|---|---|
| 发起群聊 | AXSheet | 主窗口子元素 | 遍历主窗口 AXChildren |
| 添加群成员 | AXSheet (同上) | 主窗口子元素 | 遍历主窗口 AXChildren |
| 搜索下拉菜单 | AXDialog | 独立窗口 | AXRole/AXSubrole 筛选 |
| 添加好友搜索结果 | AXWindow | 独立窗口 | 包含特征文本的窗口 |
| 发送邀请确认 | AXWindow (sr='AXUnknown') | 独立窗口 | 包含特征按钮的窗口 |

---

## 2. 关键技术经验

### 2.1 AXPress vs cliclick -- 最重要的坑

**AXPress (AXUIElementPerformAction) 适用场景：**

- 普通按钮：发起群聊、完成、取消、发送添加邀请、添加
- 文本框聚焦 (AXFocusedUIElement)

**AXPress 失效场景 -- 必须用 cliclick：**

- 联系人列表中的 checkbox / 行选择
- AXPress 会导致 checkbox 的 AXImage description 变为 `selected`，但联系人不会出现在右侧已选列表中
- 这是企微的实现问题：checkbox 的视觉状态和实际业务逻辑绑定在鼠标事件而非 AX 动作上

**cliclick 点击实现：**

```python
def click_element(elem):
    """通过 cliclick 模拟真实鼠标点击 AX 元素"""
    frame_str = str(get_attr(elem, "AXFrame") or "")
    m = re.search(r'x:([\d.]+)\s+y:([\d.]+)\s+w:([\d.]+)\s+h:([\d.]+)', frame_str)
    if not m:
        raise ValueError("无法解析 AXFrame")
    x, y, w, h = float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4))
    click_x = int(x + w / 2)
    click_y = int(y + h / 2)
    subprocess.run(["cliclick", f"c:{click_x},{click_y}"], check=True)
```

### 2.2 AXFrame 解析

**核心问题：AXFrame 返回 AXValueRef，不能直接访问属性**

```python
# 错误方式 -- 不可用
frame = get_attr(elem, "AXFrame")
x = frame.x  # AttributeError

# 正确方式 -- 转字符串 + 正则
frame_str = str(get_attr(elem, "AXFrame") or "")
m = re.search(r'x:([\d.]+)\s+y:([\d.]+)\s+w:([\d.]+)\s+h:([\d.]+)', frame_str)
```

**坐标系说明：**

- 屏幕物理分辨率为 4K Retina (3840x2160)
- AXFrame 返回逻辑坐标 (1920x1080)
- cliclick 也使用逻辑坐标
- 两者坐标系一致，无需额外换算
- Quartz 的 `AXValueGetValue` 在 pyobjc 中不可用，不要尝试

### 2.3 文本输入

**必须用 pbcopy + Cmd+V 粘贴方式：**

```python
def type_text(text):
    """通过剪贴板粘贴输入文本（支持中文）"""
    subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)
    subprocess.run(["cliclick", "kd:cmd", "t:v", "ku:cmd"], check=True)
```

**原因：**

- 直接设置 `AXValue` 可能不触发搜索回调
- AppleScript `keystroke` 不支持中文
- pbcopy + Cmd+V 是最可靠的方式，完美支持中英文混合

**清空搜索框：**

```python
def clear_search():
    subprocess.run(["cliclick", "kd:cmd", "t:a", "ku:cmd"], check=True)  # Cmd+A
    time.sleep(0.1)
    subprocess.run(["cliclick", "kp:delete"], check=True)                 # Delete
```

### 2.4 企微左侧导航栏 -- 已知死路

**现象：**

- 左侧的消息/通讯录/日历/更多等导航按钮对 AX API 几乎完全不可见
- 这些按钮没有 `AXTitle`、`AXHelp`、`AXDescription` 等可用属性
- `AXElementAtPosition(x, y)` 在该区域返回的是父容器 `AXSplitGroup` 而非按钮本身
- cliclick 坐标点击也无效（点击后没有任何响应）

**结论：**

- 放弃"更多 -> 通讯录 -> 添加客户"路径
- 改用顶部搜索框作为所有操作的统一入口
- 顶部搜索框有完整的 AX 属性，是最可靠的入口

### 2.5 AX 树遍历工具函数

```python
import ApplicationServices as AS

def get_attr(elem, attr):
    """安全获取 AX 属性"""
    err, val = AS.AXUIElementCopyAttributeValue(elem, attr, None)
    return val if err == 0 else None

def get_children(elem):
    """获取子元素列表"""
    return get_attr(elem, "AXChildren") or []

def find_by_role(root, role, depth=10):
    """递归查找指定 role 的所有元素"""
    results = []
    if depth <= 0:
        return results
    if get_attr(root, "AXRole") == role:
        results.append(root)
    for child in get_children(root):
        results.extend(find_by_role(child, role, depth - 1))
    return results
```

---

## 3. 操作流程汇总表

| 操作 | 入口 | 弹窗类型 | 搜索方式 | 选择方式 | 确认按钮 |
|---|---|---|---|---|---|
| 添加好友 | 顶部搜索框输入手机号 | AXDialog -> AXWindow | 输入手机号 -> 点击"通过手机号搜索" | 点击"添加"按钮 (AXPress) | "发送添加邀请" (AXPress) |
| 建群 | AXButton h='发起群聊' (AXPress) | AXSheet | 左侧搜索框输入名字 (pbcopy+Cmd+V) | cliclick 点击联系人行 | t='完成' (AXPress) |
| 邀请入群 | AXButton h='添加群成员' (AXPress) | AXSheet (同建群结构) | 左侧搜索框输入名字 (pbcopy+Cmd+V) | cliclick 点击联系人行 | t='确定' (AXPress) |

---

## 4. Windows UIA 迁移指南

### 4.1 API 概念映射

| macOS 概念 | Windows UIA 对应 | 说明 |
|---|---|---|
| `AXUIElementCreateApplication(pid)` | `uia.connect(process=pid)` 或 `app.window()` | pywinauto 连接进程 |
| `AXUIElementCopyAttributeValue(el, attr)` | `element.get_value()` / `.name` / `.automation_id` | 属性访问更直接 |
| `AXPress` (PerformAction) | `element.click_input()` / `.invoke()` | click_input 更可靠 |
| `cliclick c:x,y` | `pyautogui.click(x, y)` 或 `element.click_input()` | pyautogui 作为降级方案 |
| AXFrame 坐标 | `element.rectangle()` | 返回 `RECT(left, top, right, bottom)` |
| AXRole | `element.control_type()` | 如 `Button`, `Edit`, `List` 等 |
| AXTitle / AXValue | `element.window_text()` / `.legacy_properties()['Value']` | |
| AXSheet | 可能对应 Dialog 或 Window | 需实际探测确认 |
| AXChildren 遍历 | `element.children()` / `.descendants()` | pywinauto 内置递归 |
| `pbcopy` + `Cmd+V` | `pyperclip.copy()` + `Ctrl+V` 或 `element.type_keys()` | 注意中文输入法状态 |
| `press_escape()` | `element.type_keys('{ESC}')` | |

### 4.2 Windows 版核心差异

**UI 探测工具：**

- Inspect.exe (Windows SDK 自带)
- Accessibility Insights for Windows (微软开源，推荐)
- Spy++ (Visual Studio 自带)
- 这些工具在 Windows 上比 macOS 的 AX Inspector 好用得多

**预期改善点：**

- Windows UIA 的 `click_input()` 通常直接有效，不像 macOS 的 AXPress 对 checkbox 失效
- Windows UIA 属性访问更直接，不需要字符串解析 AXFrame 这种 hack
- `element.rectangle()` 直接返回结构体，可以 `.left`, `.top`, `.right`, `.bottom` 访问
- pywinauto 内置等待机制 (`wait('visible')`, `wait('enabled')`)，比手动 sleep 更可靠

**需要注意的地方：**

- 企微 Windows 版的 UI 结构可能与 macOS 完全不同，必须重新用 Inspect.exe 探测
- 坐标系：Windows 用屏幕物理像素坐标，高 DPI 缩放场景需要注意
- 中文输入：`type_keys()` 可能受输入法影响，建议仍用 `pyperclip` + `Ctrl+V`
- 弹窗类型：macOS 的 AXSheet/AXDialog 在 Windows 上可能都表现为 Dialog 或 Window

### 4.3 推荐技术栈

```
核心库：pywinauto (UIA backend)
辅助库：pyautogui (坐标点击降级方案)
剪贴板：pyperclip (跨平台剪贴板操作)
探测：Accessibility Insights for Windows
```

### 4.4 迁移步骤建议

1. 安装 Accessibility Insights，完整探测企微 Windows 版 UI 树
2. 绘制等价的 UI 结构图谱（类似本文档第 1 节）
3. 验证 `click_input()` 对联系人 checkbox 是否有效（macOS 上 AXPress 无效）
4. 实现基础工具函数（找窗口、找元素、输入文本、点击）
5. 按操作流程表逐个实现，每实现一个就跑通测试
6. 最后处理风控节奏和异常恢复

---

## 5. 风控与稳定性要点

### 5.1 操作节奏

```
操作间隔基准：
- 普通按钮点击后：sleep 0.3 ~ 0.5s
- 搜索框输入后等待结果：sleep 1.5 ~ 2.0s
- 弹窗打开后等待渲染：sleep 0.5 ~ 1.0s
- 选择联系人后（等 UI 更新）：sleep 0.3 ~ 0.5s
- 完成/确定按钮点击后：sleep 1.0 ~ 1.5s
```

### 5.2 元素引用刷新

- AX 树会因 UI 刷新而失效（元素引用变成野指针）
- 每次操作前重新从根元素遍历获取目标元素
- 不要缓存 AX 元素引用跨操作复用

### 5.3 异常恢复

```python
def press_escape():
    """按 ESC 关闭当前弹窗，恢复干净状态"""
    subprocess.run(["cliclick", "kp:escape"], check=True)
    time.sleep(0.5)

def recover_clean_state():
    """连续按多次 ESC 确保所有弹窗关闭"""
    for _ in range(3):
        press_escape()
    time.sleep(0.5)
```

### 5.4 操作验证

- 建群后：检查是否出现新的聊天窗口
- 邀请入群后：通过群成员列表验证
- 添加好友后：检查是否显示"已发送"状态
- 所有操作失败时：recover_clean_state() 后重试或上报

---

## 6. 已知限制与未解决问题

1. **左侧导航栏不可访问** -- macOS 企微 v5.0.7 的左侧导航按钮（消息/通讯录/日历/更多）对 AX API 完全不可见，无法程序化操作。所有功能入口改用顶部搜索框或聊天区域内的按钮。

2. **AXPress 对 checkbox 无效** -- 这是企微的实现特性，不是 macOS AX API 的 bug。只能通过 cliclick 模拟真实鼠标点击来绕过。

3. **AXFrame 解析依赖字符串正则** -- pyobjc 不支持 `AXValueGetValue`，只能将 AXValueRef 转字符串后正则提取坐标。这个方式虽然 hack 但稳定可靠。

4. **搜索结果延迟不可预测** -- 网络请求导致搜索结果加载时间不确定。当前用固定 sleep 等待，更好的方式是轮询检查结果是否出现。
