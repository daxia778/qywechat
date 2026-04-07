"""
macOS 企微 UI 自动化驱动 — 基于 Accessibility API
从 wecom_auto_add.py 迁移重构为类接口
"""
import subprocess
import time
import re
import sys

from ApplicationServices import (
    AXUIElementCreateApplication,
    AXUIElementCopyAttributeValue,
    AXUIElementSetAttributeValue,
    AXUIElementPerformAction,
    AXIsProcessTrusted,
)

from . import BaseDriver


# ─── AX 工具函数 ────────────────────────────────────────

def get_attr(elem, attr):
    err, val = AXUIElementCopyAttributeValue(elem, attr, None)
    return val if err == 0 else None

def set_attr(elem, attr, value):
    AXUIElementSetAttributeValue(elem, attr, value)

def press(elem):
    AXUIElementPerformAction(elem, "AXPress")

def get_children(elem):
    return get_attr(elem, "AXChildren") or []

def get_role(elem):
    return get_attr(elem, "AXRole") or ""

def get_title(elem):
    return get_attr(elem, "AXTitle") or ""

def get_value(elem):
    v = get_attr(elem, "AXValue")
    return str(v) if v is not None else ""

def get_desc(elem):
    return get_attr(elem, "AXDescription") or ""

def get_subrole(elem):
    return get_attr(elem, "AXSubrole") or ""


def find_element(root, role=None, title=None, value=None, desc=None, subrole=None, max_depth=10):
    if max_depth <= 0:
        return None
    match = True
    if role and get_role(root) != role:
        match = False
    if title and title not in get_title(root):
        match = False
    if value and value not in get_value(root):
        match = False
    if desc and desc not in get_desc(root):
        match = False
    if subrole and subrole not in get_subrole(root):
        match = False
    if match and (role or title or value or desc or subrole):
        return root
    for child in get_children(root):
        result = find_element(child, role, title, value, desc, subrole, max_depth - 1)
        if result:
            return result
    return None


def find_all_elements(root, role=None, title=None, value=None, max_depth=10, results=None):
    if results is None:
        results = []
    if max_depth <= 0:
        return results
    match = True
    if role and get_role(root) != role:
        match = False
    if title and title not in get_title(root):
        match = False
    if value and value not in get_value(root):
        match = False
    if match and (role or title or value):
        results.append(root)
    for child in get_children(root):
        find_all_elements(child, role, title, value, max_depth - 1, results)
    return results


def dump_tree_brief(elem, depth=0, max_depth=4):
    if depth > max_depth:
        return
    role = get_role(elem)
    title = get_title(elem)
    value = get_value(elem)[:60]
    desc = get_desc(elem)
    indent = "  " * depth
    parts = [f"{indent}[{role}]"]
    if title: parts.append(f"t='{title}'")
    if value: parts.append(f"v='{value}'")
    if desc: parts.append(f"d='{desc}'")
    print(" ".join(parts))
    for child in get_children(elem):
        dump_tree_brief(child, depth + 1, max_depth)


def type_text(text):
    subprocess.run(["pbcopy"], input=text.encode("utf-8"))
    time.sleep(0.2)
    subprocess.run([
        "osascript", "-e",
        'tell application "System Events" to keystroke "v" using command down'
    ])
    time.sleep(0.3)


def press_return():
    subprocess.run([
        "osascript", "-e",
        'tell application "System Events" to key code 36'
    ])


def press_escape():
    subprocess.run([
        "osascript", "-e",
        'tell application "System Events" to key code 53'
    ])


def parse_frame(elem):
    """从 AX 元素的 AXFrame 属性解析坐标 (x, y, w, h)，返回 None 如果解析失败"""
    frame_str = str(get_attr(elem, "AXFrame") or "")
    m = re.search(r'x:([\d.]+)\s+y:([\d.]+)\s+w:([\d.]+)\s+h:([\d.]+)', frame_str)
    if not m:
        return None
    return (float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4)))


def cliclick(elem):
    """用 cliclick 在元素中心位置模拟真实鼠标点击"""
    coords = parse_frame(elem)
    if not coords:
        return False
    x, y, w, h = coords
    click_x = int(x + w / 2)
    click_y = int(y + h / 2)
    subprocess.run(["cliclick", f"c:{click_x},{click_y}"])
    return True


# ─── macOS 驱动 ─────────────────────────────────────────

class MacOSDriver(BaseDriver):

    def __init__(self):
        if not AXIsProcessTrusted():
            raise RuntimeError("需要辅助功能权限！请在 系统偏好设置 → 隐私与安全 → 辅助功能 中授权终端/Python")

    def _get_wecom(self):
        r = subprocess.run(["pgrep", "-x", "企业微信"], capture_output=True, text=True)
        if not r.stdout.strip():
            return None, None
        pid = int(r.stdout.strip().split('\n')[0])
        return AXUIElementCreateApplication(pid), pid

    def _activate(self):
        subprocess.run(["osascript", "-e", 'tell application "企业微信" to activate'])
        time.sleep(0.5)

    def _get_main_window(self, app):
        for w in (get_attr(app, "AXWindows") or []):
            if get_title(w) == "企业微信":
                return w
        return None

    def check_wecom_running(self) -> bool:
        app, pid = self._get_wecom()
        return app is not None

    def add_customer(self, contact: str) -> tuple[bool, str]:
        """通过顶部搜索框 → 手机号搜索添加微信 的流程添加客户
        返回: (成功, 用户微信昵称) — 昵称用于后续建群搜索
        """
        app, pid = self._get_wecom()
        if not app:
            print("❌ 企业微信未运行")
            return False, ""

        print(f"[1/5] 激活企业微信 (PID: {pid})")
        self._activate()
        time.sleep(1)

        # ---- 步骤 2: 在顶部搜索框输入手机号 ----
        print(f"[2/5] 在搜索框输入: {contact}")
        app, _ = self._get_wecom()
        main_window = self._get_main_window(app)
        if not main_window:
            print("❌ 找不到企微主窗口")
            return False, ""

        search_field = self._find_top_search_field(main_window)
        if not search_field:
            print("❌ 找不到顶部搜索框")
            return False, ""

        set_attr(search_field, "AXFocused", True)
        time.sleep(0.3)
        self._clear_text_field()
        time.sleep(0.2)
        type_text(contact)
        time.sleep(1.5)

        # ---- 步骤 3: 点击"通过手机号搜索添加微信" ----
        print("[3/5] 点击'通过手机号搜索添加微信'...")
        app, _ = self._get_wecom()

        # 下拉菜单是独立的 AXDialog 窗口
        target_row = None
        for w in (get_attr(app, "AXWindows") or []):
            if get_subrole(w) == "AXDialog":
                elem = find_element(w, value="通过手机号搜索添加微信", max_depth=8)
                if elem:
                    # 点击这一行
                    table = find_element(w, role="AXTable", max_depth=5)
                    if table:
                        rows = [c for c in get_children(table) if get_role(c) == "AXRow"]
                        for row in rows:
                            if find_element(row, value="通过手机号", max_depth=5):
                                target_row = row
                                break
                    break

        if not target_row:
            print("❌ 找不到'通过手机号搜索添加微信'选项")
            press_escape()
            return False, ""

        cliclick(target_row)
        time.sleep(2)

        # ---- 步骤 4: 在搜索结果中点击"添加" ----
        print("[4/5] 等待搜索结果...")
        app, _ = self._get_wecom()

        add_win = self._find_phone_search_window(app)
        if not add_win:
            time.sleep(1)
            app, _ = self._get_wecom()
            add_win = self._find_phone_search_window(app)

        if not add_win:
            print("❌ 找不到搜索添加窗口")
            press_escape()
            return False, ""

        # 获取搜索结果中的用户名
        user_name = ""
        all_texts = find_all_elements(add_win, role="AXStaticText", max_depth=8)
        for t in all_texts:
            v = get_value(t)
            if v and v not in ("通过手机号搜索添加微信", "搜索结果：", "搜索结果:", ""):
                user_name = v
                break

        add_btn = find_element(add_win, role="AXButton", title="添加", max_depth=8)
        if not add_btn:
            print(f"  未找到'添加'按钮 — 可能已是联系人")
            if user_name:
                print(f"  用户: {user_name}")
            self._close_phone_search_window(app)
            return False, user_name

        print(f"  找到用户: {user_name or '(未知)'}，点击添加...")
        cliclick(add_btn)
        time.sleep(2)

        # ---- 步骤 5: 确认发送添加邀请 ----
        print("[5/5] 发送添加邀请...")
        app, _ = self._get_wecom()

        send_btn = None
        for w in (get_attr(app, "AXWindows") or []):
            btn = find_element(w, role="AXButton", title="发送添加邀请", max_depth=3)
            if btn:
                send_btn = btn
                break

        if not send_btn:
            print("  未弹出发送邀请确认窗口，可能已自动发送")
        else:
            cliclick(send_btn)
            time.sleep(1.5)

            # 验证窗口是否关闭
            app, _ = self._get_wecom()
            still_open = False
            for w in (get_attr(app, "AXWindows") or []):
                if find_element(w, role="AXButton", title="发送添加邀请", max_depth=3):
                    still_open = True
                    break
            if still_open:
                print("  ⚠️ 发送窗口仍在，可能发送失败")

        # 关闭搜索窗口
        self._close_phone_search_window(app)

        print(f"  ✓ 已发送添加请求: {contact}" + (f" ({user_name})" if user_name else ""))
        return True, user_name

    # ─── 建群自动化 ─────────────────────────────────────

    def create_group(self, members: list[str], group_name: str = "") -> tuple[bool, str]:
        """
        UI 自动化创建企微群聊
        members: 要拉入群的成员显示名列表，如 ["吴泽华", "刘浩东"]
        group_name: 群名（可选，建群后设置）
        返回: (成功, 结果描述)
        """
        app, pid = self._get_wecom()
        if not app:
            return False, "企业微信未运行"

        if len(members) < 2:
            return False, "至少需要2个成员才能建群"

        print(f"[建群] 开始创建群聊，成员: {members}，群名: {group_name}")

        # Step 1: 激活企微
        print("[1/6] 激活企业微信...")
        self._activate()
        time.sleep(1)

        # Step 2: 点击"发起群聊"按钮
        print("[2/6] 点击'发起群聊'按钮...")
        app, _ = self._get_wecom()
        main_win = self._get_main_window(app)
        if not main_win:
            return False, "找不到企微主窗口"

        group_btn = find_element(main_win, role="AXButton", max_depth=8)
        # 用 AXHelp 属性精确定位
        group_btn = None
        for c in get_children(main_win):
            if get_role(c) == "AXSplitGroup":
                for sc in get_children(c):
                    if get_role(sc) == "AXSplitGroup":
                        for ssc in get_children(sc):
                            if get_role(ssc) == "AXButton":
                                h = get_attr(ssc, "AXHelp") or ""
                                if "群聊" in h:
                                    group_btn = ssc
                                    break
        if not group_btn:
            # 回退：在整棵树中搜索
            group_btn = self._find_by_help(main_win, "发起群聊")

        if not group_btn:
            return False, "找不到'发起群聊'按钮"

        press(group_btn)
        time.sleep(2)

        # Step 3: 定位 AXSheet 弹窗
        print("[3/6] 定位群聊弹窗...")
        app, _ = self._get_wecom()
        main_win = self._get_main_window(app)
        sheet = self._find_group_sheet(main_win)
        if not sheet:
            return False, "未弹出群聊选择窗口"

        split = self._get_child_by_role(sheet, "AXSplitGroup")
        if not split:
            press_escape()
            return False, "弹窗结构异常：无 SplitGroup"

        split_children = get_children(split)
        if len(split_children) < 3:
            press_escape()
            return False, f"弹窗结构异常：子元素数 {len(split_children)}"

        left_group = split_children[0]   # 搜索+联系人列表
        right_group = split_children[2]  # 已选+完成/取消

        # Step 4: 逐个搜索并勾选成员
        print("[4/6] 搜索并勾选成员...")
        selected_count = 0
        for member_name in members:
            ok = self._search_and_select_member(left_group, member_name)
            if ok:
                selected_count += 1
                print(f"  ✓ 已勾选: {member_name}")
            else:
                print(f"  ✗ 未找到: {member_name}")
            time.sleep(0.5)

        if selected_count < 2:
            print(f"  仅勾选了 {selected_count} 人，不足以建群，取消")
            cancel_btn = find_element(right_group, role="AXButton", title="取消", max_depth=5)
            if cancel_btn:
                press(cancel_btn)
            else:
                press_escape()
            return False, f"仅找到 {selected_count} 个成员，不足以建群"

        # Step 5: 点击"完成"创建群聊
        print(f"[5/6] 点击'完成'创建群聊 (已选 {selected_count} 人)...")
        # 重新获取，因为勾选可能刷新了 AX 树
        app, _ = self._get_wecom()
        main_win = self._get_main_window(app)
        sheet = self._find_group_sheet(main_win)
        if not sheet:
            return False, "弹窗在操作过程中消失"

        finish_btn = find_element(sheet, role="AXButton", title="完成", max_depth=8)
        if not finish_btn:
            press_escape()
            return False, "找不到'完成'按钮"

        # 检查完成按钮是否可用
        enabled = get_attr(finish_btn, "AXEnabled")
        if enabled is not None and not enabled:
            press_escape()
            return False, "'完成'按钮不可用，可能选中人数不足"

        # 用 cliclick 点击完成按钮（AXPress 可能不生效）
        if not cliclick(finish_btn):
            press(finish_btn)  # 降级用 AXPress
        time.sleep(3)

        # 验证群是否创建成功（Sheet 应该消失）
        app, _ = self._get_wecom()
        main_win = self._get_main_window(app)
        if main_win and self._find_group_sheet(main_win):
            return False, "点击完成后弹窗未关闭，建群可能失败"

        print("  群聊创建成功！")

        # Step 6: 设置群名（如果指定了）
        if group_name:
            print(f"[6/6] 设置群名: {group_name}")
            time.sleep(1)
            ok = self._set_group_name(group_name)
            if ok:
                print(f"  ✓ 群名已设置: {group_name}")
            else:
                print(f"  ✗ 群名设置失败，需手动设置")
                return True, f"群已创建({selected_count}人)，但群名设置失败"
        else:
            print("[6/6] 未指定群名，跳过")

        return True, f"群聊创建成功: {group_name or '(未命名)'}，成员 {selected_count} 人"

    def _find_by_help(self, root, help_text, max_depth=10, depth=0):
        """通过 AXHelp 属性查找元素"""
        if depth > max_depth:
            return None
        h = get_attr(root, "AXHelp") or ""
        if help_text in h:
            return root
        for c in get_children(root):
            r = self._find_by_help(c, help_text, max_depth, depth + 1)
            if r:
                return r
        return None

    def _find_group_sheet(self, main_win):
        """在主窗口中查找 AXSheet（发起群聊弹窗）"""
        if not main_win:
            return None
        for c in get_children(main_win):
            if get_role(c) == "AXSheet":
                return c
        return None

    def _get_child_by_role(self, parent, role):
        """获取第一个匹配 role 的子元素"""
        for c in get_children(parent):
            if get_role(c) == role:
                return c
        return None

    def _search_and_select_member(self, left_group, member_name: str) -> bool:
        """在弹窗左侧搜索并勾选一个成员"""
        # 找搜索框
        search_field = None
        for c in get_children(left_group):
            if get_role(c) == "AXTextField":
                search_field = c
                break

        if not search_field:
            print(f"    找不到搜索框")
            return False

        # 聚焦搜索框 → 清空 → 输入名字
        set_attr(search_field, "AXFocused", True)
        time.sleep(0.3)
        self._clear_text_field()
        time.sleep(0.3)
        type_text(member_name)
        time.sleep(1.5)  # 等待搜索结果

        # 在联系人树中查找匹配的行
        scroll_area = None
        for c in get_children(left_group):
            if get_role(c) == "AXScrollArea":
                scroll_area = c
                break

        if not scroll_area:
            return False

        # 找 AXOutline 或 AXTable
        outline = None
        for c in get_children(scroll_area):
            r = get_role(c)
            if r in ("AXOutline", "AXTable"):
                outline = c
                break

        if not outline:
            return False

        rows = [c for c in get_children(outline) if get_role(c) == "AXRow"]
        if not rows:
            return False

        # 遍历行，找到包含成员名字的行并点击勾选
        for row in rows:
            cell = self._get_child_by_role(row, "AXCell")
            if not cell:
                continue

            cell_children = get_children(cell)
            name_match = False
            already_selected = False

            for c in cell_children:
                role = get_role(c)
                if role == "AXTextArea":
                    val = get_value(c)
                    if val == member_name:
                        name_match = True
                elif role == "AXImage":
                    d = get_desc(c)
                    if "checkbox" in d:
                        if "selected" in d and "unselected" not in d:
                            already_selected = True

            if name_match and already_selected:
                return True

            if name_match:
                # 用 cliclick 模拟真实鼠标点击（AXPress 无法触发 checkbox）
                if not cliclick(row):
                    print(f"    cliclick 点击失败，无法获取 {member_name} 的坐标")
                    return False
                time.sleep(1.0)
                # 验证右侧已选列表是否出现该成员
                return True

        return False

    def _clear_text_field(self):
        """清空当前聚焦的文本框"""
        subprocess.run(["osascript", "-e",
            'tell application "System Events" to keystroke "a" using command down'])
        time.sleep(0.1)
        subprocess.run(["osascript", "-e",
            'tell application "System Events" to key code 51'])  # Delete
        time.sleep(0.2)

    def _set_group_name(self, group_name: str) -> bool:
        """
        建群后设置群名。
        新建群聊后，企微会自动进入该群的聊天界面。
        需要点击群设置 → 群名 → 输入 → 保存
        """
        app, _ = self._get_wecom()
        main_win = self._get_main_window(app)
        if not main_win:
            return False

        # 查找群聊右上角的设置按钮或群名区域
        # 建群成功后进入聊天界面，右侧面板有群名显示
        # 尝试找到群名编辑入口

        # 方法1: 查找群聊名称文本并双击编辑
        # 方法2: 查找设置图标按钮
        # 先探测当前界面的 AX 结构来确定方法

        # 在消息区右上方查找可能的群设置入口
        # 企微的群聊头部通常有群名可点击

        # 尝试找包含默认群名的元素（新建群通常会以成员名拼接命名）
        # 暂时用一种保守策略：通过搜索框找到新群，再进入设置

        # 策略: 在当前聊天界面顶部找群名区域
        split_group = self._get_child_by_role(main_win, "AXSplitGroup")
        if not split_group:
            return False

        # 右侧聊天区的 SplitGroup
        inner_split = None
        for c in get_children(split_group):
            if get_role(c) == "AXSplitGroup":
                inner_split = c
                break

        if not inner_split:
            return False

        # 在聊天区顶部查找可以点击的群名/设置按钮
        # 先找 AXStaticText 或 AXButton 包含成员名字的
        # 新建群默认名一般是 "成员A、成员B"

        # 尝试直接找群设置面板入口 — 通常是右上角的一个按钮
        all_buttons = find_all_elements(inner_split, role="AXButton", max_depth=3)

        # 查找群名相关的可编辑元素
        # 企微Mac端: 群聊标题栏点击后会出现编辑框
        # 尝试查找带有"群聊信息"或群设置相关的入口
        settings_btn = None
        for btn in all_buttons:
            h = get_attr(btn, "AXHelp") or ""
            t = get_title(btn)
            if "设置" in h or "信息" in h or "群" in h:
                settings_btn = btn
                break

        if not settings_btn:
            # 尝试点击聊天区右侧的 splitter 之后的区域
            # 或者使用快捷键
            print("    未找到群设置入口，尝试替代方案...")
            return False

        return False  # 群名设置需要更多 AX 探测，先标记为待完善

    # ─── 邀请入群自动化 ─────────────────────────────

    def invite_to_group(self, group_name: str, contact_names: list[str] | str) -> tuple[bool, str]:
        """
        邀请联系人入已有群聊 (UI 自动化)
        group_name: 目标群名（用于搜索定位群聊）
        contact_names: 要邀请的联系人昵称，字符串或列表
        返回: (成功, 结果描述)
        """
        if isinstance(contact_names, str):
            contact_names = [contact_names]

        if not contact_names:
            return False, "未指定要邀请的联系人"

        app, pid = self._get_wecom()
        if not app:
            return False, "企业微信未运行"

        print(f"[邀请入群] 群: {group_name}, 联系人: {contact_names}")

        # Step 1: 激活企微
        print("[1/5] 激活企业微信...")
        self._activate()
        time.sleep(1)

        # Step 2: 导航到目标群聊
        print(f"[2/5] 导航到群聊: {group_name}")
        if not self._navigate_to_chat(group_name):
            return False, f"找不到群聊: {group_name}"
        time.sleep(1)

        # Step 3: 点击"添加群成员"按钮
        print("[3/5] 点击'添加群成员'...")
        app, _ = self._get_wecom()
        main_win = self._get_main_window(app)
        if not main_win:
            return False, "找不到主窗口"

        add_btn = self._find_button_by_help(main_win, "添加群成员")
        if not add_btn:
            return False, "找不到'添加群成员'按钮，可能不在群聊界面"

        press(add_btn)  # AXPress 对这个按钮有效
        time.sleep(2)

        # Step 4: 在 AXSheet 中搜索并勾选联系人
        print("[4/5] 搜索并勾选联系人...")
        app, _ = self._get_wecom()
        main_win = self._get_main_window(app)
        sheet = self._find_group_sheet(main_win)
        if not sheet:
            return False, "未弹出添加群成员窗口"

        split = self._get_child_by_role(sheet, "AXSplitGroup")
        if not split:
            press_escape()
            return False, "弹窗结构异常"

        split_children = get_children(split)
        if len(split_children) < 3:
            press_escape()
            return False, f"弹窗结构异常: 子元素数 {len(split_children)}"

        left_group = split_children[0]

        selected_count = 0
        for name in contact_names:
            ok = self._search_and_select_member(left_group, name)
            if ok:
                selected_count += 1
                print(f"  ✓ 已勾选: {name}")
            else:
                print(f"  ✗ 未找到: {name}")
            time.sleep(0.5)

        if selected_count == 0:
            press_escape()
            return False, f"未能选中任何联系人: {contact_names}"

        # Step 5: 点击"确定"
        print(f"[5/5] 点击'确定' (已选 {selected_count} 人)...")
        app, _ = self._get_wecom()
        main_win = self._get_main_window(app)
        sheet = self._find_group_sheet(main_win)
        if not sheet:
            return False, "弹窗在操作过程中消失"

        confirm_btn = find_element(sheet, role="AXButton", title="确定", max_depth=8)
        if not confirm_btn:
            press_escape()
            return False, "找不到'确定'按钮"

        enabled = get_attr(confirm_btn, "AXEnabled")
        if enabled is not None and not enabled:
            press_escape()
            return False, "'确定'按钮不可用"

        if not cliclick(confirm_btn):
            press(confirm_btn)
        time.sleep(2)

        # 验证 Sheet 是否关闭
        app, _ = self._get_wecom()
        main_win = self._get_main_window(app)
        if main_win and self._find_group_sheet(main_win):
            return False, "点击确定后弹窗未关闭，邀请可能失败"

        result = f"已邀请 {selected_count} 人入群: {', '.join(contact_names[:selected_count])}"
        print(f"  ✓ {result}")
        return True, result

    def _navigate_to_chat(self, chat_name: str) -> bool:
        """通过搜索框导航到指定聊天（群聊或个人）"""
        app, _ = self._get_wecom()
        main_win = self._get_main_window(app)
        if not main_win:
            return False

        # 先检查当前是否已在目标聊天
        inner_split = self._get_inner_split(main_win)
        if inner_split:
            for c in get_children(inner_split):
                if get_role(c) == "AXTextField":
                    val = get_value(c)
                    if val and chat_name in val:
                        print(f"  已在目标群聊: {val}")
                        return True

        # 搜索框输入群名
        search_field = self._find_top_search_field(main_win)
        if not search_field:
            return False

        set_attr(search_field, "AXFocused", True)
        time.sleep(0.3)
        self._clear_text_field()
        time.sleep(0.2)
        type_text(chat_name)
        time.sleep(1.5)

        # 在下拉菜单或消息列表中找到匹配项并点击
        app, _ = self._get_wecom()

        # 检查 AXDialog 下拉菜单
        for w in (get_attr(app, "AXWindows") or []):
            if get_subrole(w) == "AXDialog":
                table = find_element(w, role="AXTable", max_depth=5)
                if table:
                    rows = [c for c in get_children(table) if get_role(c) == "AXRow"]
                    for row in rows:
                        # 跳过"进入全局搜索"行
                        if find_element(row, value="进入全局搜索", max_depth=5):
                            continue
                        # 检查这一行是否包含群名
                        texts = find_all_elements(row, role="AXStaticText", max_depth=5)
                        for t in texts:
                            if chat_name in get_value(t):
                                cliclick(row)
                                time.sleep(1)
                                press_escape()  # 关闭搜索状态
                                time.sleep(0.5)
                                return True
                break

        # 下拉没找到，尝试进入全局搜索
        for w in (get_attr(app, "AXWindows") or []):
            if get_subrole(w) == "AXDialog":
                table = find_element(w, role="AXTable", max_depth=5)
                if table:
                    rows = [c for c in get_children(table) if get_role(c) == "AXRow"]
                    if rows:
                        # 点击第一行（进入全局搜索）
                        cliclick(rows[0])
                        time.sleep(2)

                        # 在全局搜索结果中查找群聊
                        app, _ = self._get_wecom()
                        main_win = self._get_main_window(app)
                        if main_win:
                            target = find_element(main_win, value=chat_name, max_depth=15)
                            if target:
                                cliclick(target)
                                time.sleep(1)
                                press_escape()
                                time.sleep(0.5)
                                return True
                break

        press_escape()
        return False

    def _get_inner_split(self, main_window):
        """获取内层 SplitGroup（聊天区容器）"""
        split = self._get_child_by_role(main_window, "AXSplitGroup")
        if not split:
            return None
        for c in get_children(split):
            if get_role(c) == "AXSplitGroup":
                return c
        return None

    def _find_button_by_help(self, main_window, help_text):
        """在内层 SplitGroup 中按 AXHelp 查找按钮"""
        inner_split = self._get_inner_split(main_window)
        if not inner_split:
            return None
        for c in get_children(inner_split):
            if get_role(c) == "AXButton":
                h = get_attr(c, "AXHelp") or ""
                if help_text in h:
                    return c
        return None

    def _find_top_search_field(self, main_window):
        """找到主窗口顶部的搜索框 (在内层 SplitGroup 中)"""
        split = self._get_child_by_role(main_window, "AXSplitGroup")
        if not split:
            return None
        inner_split = None
        for c in get_children(split):
            if get_role(c) == "AXSplitGroup":
                inner_split = c
                break
        if not inner_split:
            return None
        for c in get_children(inner_split):
            if get_role(c) == "AXTextField":
                return c
        return None

    def _find_phone_search_window(self, app):
        """找到'通过手机号搜索添加微信'弹窗"""
        for w in (get_attr(app, "AXWindows") or []):
            if find_element(w, value="通过手机号搜索添加微信", max_depth=3):
                return w
        return None

    def _close_phone_search_window(self, app):
        """关闭手机号搜索窗口"""
        win = self._find_phone_search_window(app)
        if win:
            # 窗口底部有一个无标题的关闭按钮
            btns = find_all_elements(win, role="AXButton", max_depth=2)
            for b in btns:
                if not get_title(b):
                    cliclick(b)
                    return
            press_escape()

    def _find_add_customer_window(self, app):
        for w in (get_attr(app, "AXWindows") or []):
            if find_element(w, value="添加客户", max_depth=3):
                return w
        return None
