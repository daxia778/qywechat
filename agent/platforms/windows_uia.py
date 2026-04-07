"""
Windows 企微 UI 自动化驱动 — 基于 pywinauto
生产环境使用，需要安装: pip install pywinauto
"""
import time
import subprocess

from . import BaseDriver


class WindowsDriver(BaseDriver):

    def __init__(self):
        try:
            import pywinauto
            self._pywinauto = pywinauto
        except ImportError:
            raise RuntimeError("需要安装 pywinauto: pip install pywinauto")

    def check_wecom_running(self) -> bool:
        try:
            from pywinauto import Application
            Application(backend="uia").connect(path="WXWork.exe")
            return True
        except Exception:
            return False

    def add_customer(self, contact: str) -> bool:
        """通过手机号或微信号添加企微客户（Windows 版）"""
        from pywinauto import Application
        from pywinauto.keyboard import send_keys

        try:
            app = Application(backend="uia").connect(path="WXWork.exe")
        except Exception as e:
            print(f"❌ 无法连接企业微信: {e}")
            return False

        try:
            main_win = app.window(title="企业微信")
            main_win.set_focus()
            time.sleep(1)

            # 步骤 1: 点击左侧"更多"按钮（通常是底部最后一个图标）
            print("[1/7] 点击左侧'更多'按钮...")
            # 企微 Windows 版左侧导航栏结构：
            # 尝试通过 AutomationId 或位置查找
            try:
                more_btn = main_win.child_window(title="更多", control_type="Button")
                more_btn.click_input()
            except Exception:
                # 备选：通过坐标点击左下角
                buttons = main_win.children(control_type="Button")
                if buttons:
                    buttons[-1].click_input()
            time.sleep(1.5)

            # 步骤 2: 点击"新的客户"
            print("[2/7] 查找'新的客户'...")
            try:
                new_customer = main_win.child_window(title="新的客户", control_type="Text")
                new_customer.click_input()
            except Exception:
                # 尝试 ListItem
                try:
                    new_customer = main_win.child_window(title_re=".*新的客户.*")
                    new_customer.click_input()
                except Exception:
                    print("❌ 找不到'新的客户'，请确认企微版本")
                    return False
            time.sleep(1)

            # 步骤 3: 点击右上角"添加"
            print("[3/7] 点击'添加'按钮...")
            try:
                add_btn = main_win.child_window(title="添加", control_type="Button")
                add_btn.click_input()
            except Exception:
                print("❌ 找不到'添加'按钮")
                return False
            time.sleep(2)

            # 步骤 4: 在弹窗中输入联系方式
            print(f"[4/7] 输入联系方式: {contact}")
            # 查找"添加客户"弹窗
            try:
                add_dlg = app.window(title_re=".*添加客户.*")
                add_dlg.wait("visible", timeout=5)
            except Exception:
                # 可能弹窗没有独立标题，在主窗口内
                add_dlg = main_win

            # 查找输入框
            try:
                edit = add_dlg.child_window(control_type="Edit")
                edit.set_focus()
                time.sleep(0.3)
                edit.set_edit_text("")
                time.sleep(0.2)
                edit.type_keys(contact, with_spaces=True, pause=0.05)
            except Exception:
                # 备选：直接键盘输入
                send_keys(contact, pause=0.05)
            time.sleep(0.5)

            # 按回车搜索
            send_keys("{ENTER}")

            # 步骤 5: 等待搜索结果
            print("[5/7] 等待搜索结果...")
            found = False
            for _ in range(20):
                time.sleep(0.5)
                try:
                    result_text = add_dlg.child_window(title_re=".*搜索结果.*", control_type="Text")
                    if result_text.exists():
                        found = True
                        break
                except Exception:
                    pass

            if not found:
                print("❌ 搜索超时，未找到用户")
                send_keys("{ESCAPE}")
                return False

            print("  找到搜索结果")

            # 步骤 6: 点击"添加"按钮发送请求
            print("[6/7] 点击'添加'发送好友请求...")
            try:
                # 弹窗内的"添加"按钮
                confirm_btn = add_dlg.child_window(title="添加", control_type="Button")
                confirm_btn.click_input()
            except Exception:
                print("❌ 找不到确认'添加'按钮")
                return False

            time.sleep(1.5)
            print("[7/7] 添加请求已发送")
            print(f"  已发送添加请求: {contact}")
            return True

        except Exception as e:
            print(f"❌ 操作异常: {e}")
            return False
